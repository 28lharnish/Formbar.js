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

jest.mock("@services/socket-updates-service", () => ({
    managerUpdate: jest.fn().mockResolvedValue(),
    userUpdateSocket: jest.fn(),
}));

jest.mock("@services/user-service", () => ({
    ...jest.requireActual("@services/user-service"),
    requestVerificationEmail: jest.fn().mockResolvedValue({ alreadyVerified: false }),
    verifyEmailFromCode: jest.fn().mockResolvedValue({ userId: 1, alreadyVerified: false }),
}));

const { settings } = require("@modules/config");
const userService = require("@services/user-service");
const verifyController = require("../user/verify");
const app = createTestApp(verifyController);

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    clearClassStateStore();
    settings.emailEnabled = false;
    userService.requestVerificationEmail.mockClear();
    userService.verifyEmailFromCode.mockClear();
});

afterAll(async () => {
    await mockDatabase.close();
});

async function seedStudent(overrides = {}) {
    return seedAuthenticatedUser(mockDatabase, { permissions: 2, ...overrides });
}

async function seedSecondStudent() {
    return seedAuthenticatedUser(mockDatabase, {
        email: "student2@example.com",
        displayName: "Student2",
        permissions: 2,
    });
}

async function seedManager() {
    return seedAuthenticatedUser(mockDatabase, {
        email: "admin@example.com",
        displayName: "Admin1",
        permissions: 5,
    });
}

describe("POST /api/v1/user/:id/verify/request", () => {
    it("returns 401 without auth", async () => {
        const { user } = await seedStudent();

        const res = await request(app).post(`/api/v1/user/${user.id}/verify/request`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when requesting verification for another user", async () => {
        const { tokens } = await seedStudent();
        const { user: other } = await seedSecondStudent();

        const res = await request(app).post(`/api/v1/user/${other.id}/verify/request`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 503 when email service is disabled", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app).post(`/api/v1/user/${user.id}/verify/request`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(503);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 on success when email is enabled", async () => {
        settings.emailEnabled = true;
        const { tokens, user } = await seedStudent();

        const res = await request(app).post(`/api/v1/user/${user.id}/verify/request`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.message).toBe("Verification email has been sent.");
        expect(userService.requestVerificationEmail).toHaveBeenCalledWith(String(user.id), expect.any(String));
    });
});

describe("GET /api/v1/user/verify/email", () => {
    it("returns 400 when code is missing", async () => {
        const res = await request(app).get("/api/v1/user/verify/email");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 with a valid code", async () => {
        const res = await request(app).get("/api/v1/user/verify/email?code=valid-code");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.message).toBe("User has been verified successfully.");
        expect(userService.verifyEmailFromCode).toHaveBeenCalledWith("valid-code");
    });
});

describe("PATCH /api/v1/user/:id/verify", () => {
    it("returns 401 without auth", async () => {
        const { user } = await seedStudent();

        const res = await request(app).patch(`/api/v1/user/${user.id}/verify`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when a student tries to verify a user", async () => {
        const { tokens: studentTokens } = await seedStudent();
        const { user: target } = await seedSecondStudent();

        const res = await request(app).patch(`/api/v1/user/${target.id}/verify`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 when a manager verifies an existing user", async () => {
        const { tokens: managerTokens } = await seedManager();
        const { user: target } = await seedStudent();

        const res = await request(app).patch(`/api/v1/user/${target.id}/verify`).set("Authorization", `Bearer ${managerTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.ok).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Deprecated endpoint
// ---------------------------------------------------------------------------
describe("POST /api/v1/user/:id/verify (deprecated)", () => {
    it("returns 200 with deprecation headers when a manager verifies a user", async () => {
        const { tokens: managerTokens } = await seedManager();
        const { user: target } = await seedStudent();

        const res = await request(app).post(`/api/v1/user/${target.id}/verify`).set("Authorization", `Bearer ${managerTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.headers["x-deprecated"]).toBeDefined();
        expect(res.headers["warning"]).toMatch(/299/);
    });
});
