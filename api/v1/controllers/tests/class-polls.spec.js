const request = require("supertest");
const { createTestDb } = require("@test-helpers/db");
const { createTestApp, seedAuthenticatedUser, seedClassMembership, clearClassStateStore } = require("./helpers/test-app");

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

jest.mock("@services/poll-service", () => ({
    createPoll: jest.fn().mockResolvedValue(undefined),
    updatePoll: jest.fn().mockResolvedValue(undefined),
    clearPoll: jest.fn().mockResolvedValue(undefined),
    sendPollResponse: jest.fn(),
    getCurrentPoll: jest.fn().mockResolvedValue({ status: "active", prompt: "Test?" }),
    getPreviousPolls: jest.fn().mockResolvedValue({ polls: [], total: 0 }),
}));

const createClassController = require("../class/create");
const joinController = require("../class/join");
const pollCreateController = require("../class/polls/create");
const pollEndController = require("../class/polls/end");
const pollClearController = require("../class/polls/clear");
const pollResponseController = require("../class/polls/response");
const pollCurrentController = require("../class/polls/current");
const pollsController = require("../class/polls/polls");

const app = createTestApp(
    createClassController,
    joinController,
    pollCreateController,
    pollEndController,
    pollClearController,
    pollResponseController,
    pollCurrentController,
    pollsController
);

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
        .send({ name: "Poll Test Class" });
    const classId = createRes.body.data.classId;
    // Teacher must join so they appear in classroom.students (required by hasClassScope)
    await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);
    return { classId, teacherTokens, teacher };
}

async function setupClassWithStudentAndTeacher() {
    const { classId, teacherTokens, teacher } = await setupClassWithTeacher();
    const { tokens: studentTokens, user: student } = await seedAuthenticatedUser(mockDatabase, {
        email: "student@test.com",
        displayName: "Student1",
        permissions: 2,
    });
    await seedClassMembership(mockDatabase, student.id, classId, 2);
    await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${studentTokens.accessToken}`);
    return { classId, teacherTokens, studentTokens, teacher, student };
}

describe("POST /api/v1/class/:id/polls/create", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/polls/create").send({ prompt: "Test?" });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when class is not in state store", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "lonely@test.com",
            displayName: "Lonely",
            permissions: 4,
        });

        const res = await request(app)
            .post("/api/v1/class/9999/polls/create")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ prompt: "Test?" });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 and calls createPoll on success", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();
        const { createPoll } = require("@services/poll-service");

        const pollBody = {
            prompt: "What is 2+2?",
            answers: ["3", "4", "5"],
            weight: 1,
            tags: [],
            excludedRespondents: [],
            indeterminate: [],
            allowTextResponses: false,
            allowMultipleResponses: false,
        };

        const res = await request(app)
            .post(`/api/v1/class/${classId}/polls/create`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send(pollBody);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(createPoll).toHaveBeenCalledWith(
            String(classId),
            expect.objectContaining({ prompt: "What is 2+2?" }),
            expect.objectContaining({ email: "teacher@test.com" })
        );
    });
});

describe("POST /api/v1/class/:id/polls/end", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/polls/end");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when class is not in state store", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "lonely@test.com",
            displayName: "Lonely",
            permissions: 4,
        });

        const res = await request(app).post("/api/v1/class/9999/polls/end").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 and calls updatePoll on success", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();
        const { updatePoll } = require("@services/poll-service");

        const res = await request(app).post(`/api/v1/class/${classId}/polls/end`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(updatePoll).toHaveBeenCalledWith(String(classId), { status: false }, expect.objectContaining({ email: "teacher@test.com" }));
    });
});

describe("POST /api/v1/class/:id/polls/clear", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/polls/clear");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when class is not in state store", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "lonely@test.com",
            displayName: "Lonely",
            permissions: 4,
        });

        const res = await request(app).post("/api/v1/class/9999/polls/clear").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 and calls clearPoll on success", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();
        const { clearPoll } = require("@services/poll-service");

        const res = await request(app).post(`/api/v1/class/${classId}/polls/clear`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(clearPoll).toHaveBeenCalledWith(String(classId), expect.objectContaining({ email: "teacher@test.com" }));
    });
});

describe("POST /api/v1/class/:id/polls/response", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app)
            .post("/api/v1/class/1/polls/response")
            .send({ response: ["4"], textRes: "My answer" });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when class is not in state store", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "lonely@test.com",
            displayName: "Lonely",
            permissions: 2,
        });

        const res = await request(app)
            .post("/api/v1/class/9999/polls/response")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ response: ["4"], textRes: "My answer" });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 and calls sendPollResponse on success", async () => {
        const { classId, studentTokens } = await setupClassWithStudentAndTeacher();
        const { sendPollResponse } = require("@services/poll-service");

        const res = await request(app)
            .post(`/api/v1/class/${classId}/polls/response`)
            .set("Authorization", `Bearer ${studentTokens.accessToken}`)
            .send({ response: ["4"], textRes: "My answer" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        // parseJson middleware double-parses the already-parsed JSON body,
        // so ["4"] becomes the number 4 (via JSON.parse(["4"].toString()))
        expect(sendPollResponse).toHaveBeenCalledWith(String(classId), 4, "My answer", expect.objectContaining({ email: "student@test.com" }));
    });
});

describe("GET /api/v1/class/:id/polls/current", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/polls/current");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 and the current poll data", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();
        const { getCurrentPoll } = require("@services/poll-service");

        const res = await request(app).get(`/api/v1/class/${classId}/polls/current`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({ status: "active", prompt: "Test?" });
        expect(getCurrentPoll).toHaveBeenCalledWith(String(classId), expect.objectContaining({ email: "teacher@test.com" }));
    });
});

describe("GET /api/v1/class/:id/polls", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/polls");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when user is not in the class", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "outsider@test.com",
            displayName: "Outsider",
            permissions: 2,
        });

        const res = await request(app).get("/api/v1/class/9999/polls").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 with poll history for a student in the class", async () => {
        const { classId, studentTokens } = await setupClassWithStudentAndTeacher();
        const { classStateStore } = require("@services/classroom-service");
        const { getPreviousPolls } = require("@services/poll-service");

        // Ensure the student's activeClass is set
        const userState = classStateStore.getUser("student@test.com");
        if (!userState || userState.activeClass !== classId) {
            classStateStore.updateUser("student@test.com", { activeClass: classId });
        }

        const res = await request(app).get(`/api/v1/class/${classId}/polls`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({
            polls: [],
            pagination: {
                total: 0,
                limit: 20,
                offset: 0,
                hasMore: false,
            },
        });
        expect(getPreviousPolls).toHaveBeenCalledWith(String(classId), 20, 0);
    });

    it("returns standardized previous poll fields", async () => {
        const { classId, studentTokens } = await setupClassWithStudentAndTeacher();
        const { classStateStore } = require("@services/classroom-service");
        const { getPreviousPolls } = require("@services/poll-service");

        classStateStore.updateUser("student@test.com", { activeClass: classId });
        getPreviousPolls.mockResolvedValueOnce({
            polls: [
                {
                    globalPollId: 112,
                    classPollId: 12,
                    prompt: "True/False",
                    responses: [{ answer: "True", weight: 1, color: "#00ff00", responses: 8 }],
                    allowMultipleResponses: false,
                    blind: false,
                    allowTextResponses: false,
                    createdAt: 1712428800000,
                },
            ],
            total: 1,
        });

        const res = await request(app).get(`/api/v1/class/${classId}/polls`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.polls[0]).toEqual(
            expect.objectContaining({
                globalPollId: 112,
                classPollId: 12,
                prompt: "True/False",
                allowMultipleResponses: false,
                blind: false,
                allowTextResponses: false,
            })
        );
        expect(res.body.data.polls[0]).not.toHaveProperty("id");
        expect(res.body.data.polls[0]).not.toHaveProperty("class");
    });

    it("passes custom limit and offset query params", async () => {
        const { classId, studentTokens } = await setupClassWithStudentAndTeacher();
        const { classStateStore } = require("@services/classroom-service");
        const { getPreviousPolls } = require("@services/poll-service");

        classStateStore.updateUser("student@test.com", { activeClass: classId });

        const res = await request(app)
            .get(`/api/v1/class/${classId}/polls?limit=5&offset=10`)
            .set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(getPreviousPolls).toHaveBeenCalledWith(String(classId), 5, 10);
    });

    it("returns 400 when limit is invalid", async () => {
        const { classId, studentTokens } = await setupClassWithStudentAndTeacher();
        const { classStateStore } = require("@services/classroom-service");
        const { getPreviousPolls } = require("@services/poll-service");

        classStateStore.updateUser("student@test.com", { activeClass: classId });

        const res = await request(app).get(`/api/v1/class/${classId}/polls?limit=101`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(getPreviousPolls).not.toHaveBeenCalled();
    });

    it("returns 400 when offset is invalid", async () => {
        const { classId, studentTokens } = await setupClassWithStudentAndTeacher();
        const { classStateStore } = require("@services/classroom-service");
        const { getPreviousPolls } = require("@services/poll-service");

        classStateStore.updateUser("student@test.com", { activeClass: classId });

        const res = await request(app).get(`/api/v1/class/${classId}/polls?offset=-1`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(getPreviousPolls).not.toHaveBeenCalled();
    });
});
