const request = require("supertest");
const { createTestDb } = require("@test-helpers/db");
const { createTestApp, seedAuthenticatedUser, clearClassStateStore } = require("./helpers/test-app");

let mockDatabase;

jest.mock("@modules/database", () => {
    const dbProxy = new Proxy(
        {},
        {
            get(_, method) {
                return (...args) => mockDatabase.db[method](...args);
            },
        }
    );
    return {
        get database() {
            return dbProxy;
        },
        dbGet: (...args) => mockDatabase.dbGet(...args),
        dbRun: (...args) => mockDatabase.dbRun(...args),
        dbGetAll: (...args) => mockDatabase.dbGetAll(...args),
    };
});

jest.mock("@modules/config", () => {
    const crypto = require("crypto");
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return {
        settings: { emailEnabled: false, oidcProviders: [] },
        publicKey,
        privateKey,
        frontendUrl: "http://localhost:3000",
    };
});

jest.mock("@modules/web-server", () => ({
    io: { to: () => ({ emit: jest.fn() }) },
}));

jest.mock("@services/socket-updates-service", () => ({
    advancedEmitToClass: jest.fn(),
    emitToUser: jest.fn(),
    setClassOfApiSockets: jest.fn(),
    setClassOfUserSockets: jest.fn(),
    userUpdateSocket: jest.fn(),
    invalidateClassPollCache: jest.fn(),
}));

jest.mock("@stores/socket-state-store", () => ({
    socketStateStore: {
        getUserSocketsByEmail: jest.fn().mockReturnValue(null),
    },
}));

const createClassController = require("../class/create");
const joinController = require("../class/join");
const pollSaveUserTemplateController = require("../class/polls/save-template");
const pollSaveClassTemplateController = require("../class/polls/save-class-template");

const app = createTestApp(createClassController, joinController, pollSaveUserTemplateController, pollSaveClassTemplateController);

const templateBody = {
    name: "Saved Template",
    prompt: "Pick one",
    answers: [
        { answer: "A", weight: 1, color: "#ff0000" },
        { answer: "B", weight: 1, color: "#0000ff" },
    ],
    allowTextResponses: false,
    blind: false,
    allowVoteChanges: true,
    allowMultipleResponses: false,
    weight: 1,
    public: false,
};

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    clearClassStateStore();
    jest.clearAllMocks();
});

afterAll(async () => {
    await mockDatabase.close();
});

async function setupClassWithTeacher() {
    const { tokens: teacherTokens, user: teacher } = await seedAuthenticatedUser(mockDatabase, {
        email: "teacher@test.com",
        displayName: "Teacher",
        permissions: 4,
    });
    const createRes = await request(app)
        .post("/api/v1/class/create")
        .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
        .send({ name: "Template Test Class" });
    const classId = createRes.body.data.classId;
    await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);
    return { classId, teacherTokens, teacher };
}

describe("GET /api/v1/class/:id/polls/templates/user", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/polls/templates/user");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns owned, shared, and public poll templates", async () => {
        const { classId, teacherTokens, teacher } = await setupClassWithTeacher();

        const saveRes = await request(app)
            .post(`/api/v1/class/${classId}/polls/templates/user`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send(templateBody);

        const res = await request(app)
            .get(`/api/v1/class/${classId}/polls/templates/user`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.polls).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: saveRes.body.data.pollId,
                    name: "Saved Template",
                    prompt: "Pick one",
                    allowTextResponses: false,
                    owner: Number(teacher.id),
                }),
                expect.objectContaining({ id: 1, name: "TUTD", public: true }),
            ])
        );
    });
});

describe("POST /api/v1/class/:id/polls/templates/user", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/polls/templates/user").send(templateBody);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 and saves a custom poll template for the user", async () => {
        const { classId, teacherTokens, teacher } = await setupClassWithTeacher();

        const res = await request(app)
            .post(`/api/v1/class/${classId}/polls/templates/user`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send(templateBody);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.pollId).toEqual(expect.any(Number));
        expect(res.body.data.message).toBe("Poll saved successfully!");

        const saved = await mockDatabase.dbGet("SELECT * FROM custom_polls WHERE id=?", [res.body.data.pollId]);
        expect(Number(saved.owner)).toBe(Number(teacher.id));
        expect(saved.name).toBe("Saved Template");

        const classLink = await mockDatabase.dbGet("SELECT * FROM class_polls WHERE pollId=? AND classId=?", [res.body.data.pollId, classId]);
        expect(classLink).toBeUndefined();
    });

    it("returns 400 when name is missing", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();

        const res = await request(app)
            .post(`/api/v1/class/${classId}/polls/templates/user`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ ...templateBody, name: "   " });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when prompt is missing", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();

        const res = await request(app)
            .post(`/api/v1/class/${classId}/polls/templates/user`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ ...templateBody, prompt: "   " });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when answers are empty", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();

        const res = await request(app)
            .post(`/api/v1/class/${classId}/polls/templates/user`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ ...templateBody, answers: [] });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});

describe("GET /api/v1/class/:id/polls/templates/class", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/polls/templates/class");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns class-linked poll templates", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();

        const saveRes = await request(app)
            .post(`/api/v1/class/${classId}/polls/templates/class`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send(templateBody);

        const res = await request(app)
            .get(`/api/v1/class/${classId}/polls/templates/class`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.polls).toEqual([
            expect.objectContaining({
                id: saveRes.body.data.pollId,
                name: "Saved Template",
                prompt: "Pick one",
            }),
        ]);
    });
});

describe("POST /api/v1/class/:id/polls/templates/class", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/polls/templates/class").send(templateBody);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 and saves a class poll template", async () => {
        const { classId, teacherTokens, teacher } = await setupClassWithTeacher();

        const res = await request(app)
            .post(`/api/v1/class/${classId}/polls/templates/class`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send(templateBody);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.pollId).toEqual(expect.any(Number));
        expect(res.body.data.message).toBe("Poll saved to class.");

        const saved = await mockDatabase.dbGet("SELECT * FROM custom_polls WHERE id=?", [res.body.data.pollId]);
        expect(Number(saved.owner)).toBe(Number(teacher.id));

        const classLink = await mockDatabase.dbGet("SELECT * FROM class_polls WHERE pollId=? AND classId=?", [res.body.data.pollId, classId]);
        expect(classLink).toBeTruthy();
    });
});
