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
    sendHelpTicket: jest.fn().mockResolvedValue(true),
    deleteHelpTicket: jest.fn().mockResolvedValue(true),
}));

const createController = require("../class/create");
const joinController = require("../class/join");
const helpRequestController = require("../class/help/request");
const helpDeleteController = require("../class/help/delete");

const app = createTestApp(createController, joinController, helpRequestController, helpDeleteController);

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

describe("POST /api/v1/class/:id/help/request", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/help/request");
        expect(res.status).toBe(401);
    });

    it("returns 403 when class not in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "user@test.com",
            permissions: 2,
        });

        const res = await request(app)
            .post("/api/v1/class/9999/help/request")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ reason: "Need help" });

        expect(res.status).toBe(403);
    });

    it("returns 200 on success", async () => {
        const { classId, studentTokens } = await setupClassWithStudent();

        const res = await request(app)
            .post(`/api/v1/class/${classId}/help/request`)
            .set("Authorization", `Bearer ${studentTokens.accessToken}`)
            .send({ reason: "Need help with homework" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe("DELETE /api/v1/class/:id/students/:userId/help", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).delete("/api/v1/class/1/students/1/help");
        expect(res.status).toBe(401);
    });

    it("returns 403 when class not in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "user@test.com",
            permissions: 4,
        });

        const res = await request(app).delete("/api/v1/class/9999/students/1/help").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
    });

    it("returns 200 on success", async () => {
        const { classId, teacherTokens, student } = await setupClassWithStudent();

        // Teacher needs to join the class to be in classStateStore
        await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        const res = await request(app)
            .delete(`/api/v1/class/${classId}/students/${student.id}/help`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Deprecated endpoints
// ---------------------------------------------------------------------------
describe("GET /api/v1/class/:id/help/request (deprecated)", () => {
    it("returns 200 with deprecation headers on success", async () => {
        const { classId, studentTokens } = await setupClassWithStudent();

        const res = await request(app).get(`/api/v1/class/${classId}/help/request`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.headers["x-deprecated"]).toBeDefined();
        expect(res.headers["warning"]).toMatch(/299/);
    });
});

describe("GET /api/v1/class/:id/students/:userId/help/delete (deprecated)", () => {
    it("returns 200 with deprecation headers on success", async () => {
        const { classId, teacherTokens, student } = await setupClassWithStudent();

        await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        const res = await request(app)
            .get(`/api/v1/class/${classId}/students/${student.id}/help/delete`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.headers["x-deprecated"]).toBeDefined();
        expect(res.headers["warning"]).toMatch(/299/);
    });
});
