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

jest.mock("@services/class-service", () => ({
    ...jest.requireActual("@services/class-service"),
    requestBreak: jest.fn().mockReturnValue(true),
    approveBreak: jest.fn().mockResolvedValue(true),
    endBreak: jest.fn(),
}));

const createController = require("../class/create");
const joinController = require("../class/join");
const breakRequestController = require("../class/break/request");
const breakEndController = require("../class/break/end");
const breakApproveController = require("../class/break/approve");
const breakDenyController = require("../class/break/deny");

const app = createTestApp(createController, joinController, breakRequestController, breakEndController, breakApproveController, breakDenyController);

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    clearClassStateStore();
});

afterAll(async () => {
    await mockDatabase.close();
});

async function setupClassWithStudent() {
    const { tokens: teacherTokens, user: teacher } = await seedAuthenticatedUser(mockDatabase, {
        email: "teacher@test.com",
        displayName: "Teacher",
        permissions: 4,
    });

    const createRes = await request(app)
        .post("/api/v1/class/create")
        .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
        .send({ name: "Test Class" });
    const classId = createRes.body.data.classId;

    const { tokens: studentTokens, user: student } = await seedAuthenticatedUser(mockDatabase, {
        email: "student@test.com",
        displayName: "Student1",
        permissions: 2,
    });

    await seedClassMembership(mockDatabase, student.id, classId, 2);

    await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

    return { classId, teacherTokens, studentTokens, teacher, student };
}

describe("POST /api/v1/class/:id/break/request", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/break/request");
        expect(res.status).toBe(401);
    });

    it("returns 403 when class not in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "user@test.com",
            permissions: 2,
        });

        const res = await request(app)
            .post("/api/v1/class/9999/break/request")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ reason: "Need a break" });

        expect(res.status).toBe(403);
    });

    it("returns 400 when reason is missing", async () => {
        const { classId, studentTokens } = await setupClassWithStudent();

        const res = await request(app)
            .post(`/api/v1/class/${classId}/break/request`)
            .set("Authorization", `Bearer ${studentTokens.accessToken}`)
            .send({});

        expect(res.status).toBe(400);
    });

    it("returns 200 on success", async () => {
        const { classId, studentTokens } = await setupClassWithStudent();

        const res = await request(app)
            .post(`/api/v1/class/${classId}/break/request`)
            .set("Authorization", `Bearer ${studentTokens.accessToken}`)
            .send({ reason: "Need a break" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe("POST /api/v1/class/:id/break/end", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/break/end");
        expect(res.status).toBe(401);
    });

    it("returns 403 when class not in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "user@test.com",
            permissions: 2,
        });

        const res = await request(app).post("/api/v1/class/9999/break/end").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
    });

    it("returns 200 on success", async () => {
        const { classId, studentTokens } = await setupClassWithStudent();

        const res = await request(app).post(`/api/v1/class/${classId}/break/end`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe("POST /api/v1/class/:id/students/:userId/break/approve", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/students/1/break/approve");
        expect(res.status).toBe(401);
    });

    it("returns 403 when class not in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "user@test.com",
            permissions: 4,
        });

        const res = await request(app).post("/api/v1/class/9999/students/1/break/approve").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
    });

    it("returns 200 on success", async () => {
        const { classId, teacherTokens, student } = await setupClassWithStudent();

        // Teacher needs to join the class to be in classStateStore
        await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        const res = await request(app)
            .post(`/api/v1/class/${classId}/students/${student.id}/break/approve`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe("POST /api/v1/class/:id/students/:userId/break/deny", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/students/1/break/deny");
        expect(res.status).toBe(401);
    });

    it("returns 403 when class not in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "user@test.com",
            permissions: 4,
        });

        const res = await request(app).post("/api/v1/class/9999/students/1/break/deny").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
    });

    it("returns 200 on success", async () => {
        const { classId, teacherTokens, student } = await setupClassWithStudent();

        await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        const res = await request(app)
            .post(`/api/v1/class/${classId}/students/${student.id}/break/deny`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Deprecated endpoint
// ---------------------------------------------------------------------------
describe("GET /api/v1/class/:id/students/:userId/break/approve (deprecated)", () => {
    it("returns 200 with deprecation headers on success", async () => {
        const { classId, teacherTokens, student } = await setupClassWithStudent();

        await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        const res = await request(app)
            .get(`/api/v1/class/${classId}/students/${student.id}/break/approve`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.headers["x-deprecated"]).toBeDefined();
        expect(res.headers["warning"]).toMatch(/299/);
    });
});
