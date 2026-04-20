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
    updatePin: jest.fn().mockResolvedValue(undefined),
    verifyPin: jest.fn().mockResolvedValue(undefined),
    requestPinReset: jest.fn().mockResolvedValue(undefined),
    resetPin: jest.fn().mockResolvedValue(undefined),
}));

const { settings } = require("@modules/config");
const userService = require("@services/user-service");
const pinController = require("../user/pin/pin");
const pinVerifyController = require("../user/pin/verify");
const pinResetController = require("../user/pin/reset");
const app = createTestApp(pinController, pinVerifyController, pinResetController);

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    clearClassStateStore();
    settings.emailEnabled = false;
    jest.clearAllMocks();
});

afterAll(async () => {
    await mockDatabase.close();
});

async function seedVerifiedUser(overrides = {}) {
    const result = await seedAuthenticatedUser(mockDatabase, { permissions: 2, ...overrides });
    await mockDatabase.dbRun("UPDATE users SET verified = 1 WHERE id = ?", [result.user.id]);
    return result;
}

async function seedSecondVerifiedUser() {
    const result = await seedAuthenticatedUser(mockDatabase, {
        email: "student2@example.com",
        displayName: "Student2",
        permissions: 2,
    });
    await mockDatabase.dbRun("UPDATE users SET verified = 1 WHERE id = ?", [result.user.id]);
    return result;
}

describe("PATCH /api/v1/user/:id/pin", () => {
    it("returns 401 without auth", async () => {
        const { user } = await seedVerifiedUser();

        const res = await request(app).patch(`/api/v1/user/${user.id}/pin`).send({ pin: "1234" });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when updating another user's PIN", async () => {
        const { tokens } = await seedVerifiedUser();
        const { user: other } = await seedSecondVerifiedUser();

        const res = await request(app)
            .patch(`/api/v1/user/${other.id}/pin`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ pin: "1234" });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 for invalid PIN format", async () => {
        const { tokens, user } = await seedVerifiedUser();

        const res = await request(app).patch(`/api/v1/user/${user.id}/pin`).set("Authorization", `Bearer ${tokens.accessToken}`).send({ pin: "abc" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 on success", async () => {
        const { tokens, user } = await seedVerifiedUser();

        const res = await request(app)
            .patch(`/api/v1/user/${user.id}/pin`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ pin: "1234" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.message).toBe("PIN updated successfully.");
        expect(userService.updatePin).toHaveBeenCalledWith(user.id, undefined, "1234");
    });
});

describe("POST /api/v1/user/:id/pin/verify", () => {
    it("returns 401 without auth", async () => {
        const { user } = await seedVerifiedUser();

        const res = await request(app).post(`/api/v1/user/${user.id}/pin/verify`).send({ pin: "1234" });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when verifying another user's PIN", async () => {
        const { tokens } = await seedVerifiedUser();
        const { user: other } = await seedSecondVerifiedUser();

        const res = await request(app)
            .post(`/api/v1/user/${other.id}/pin/verify`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ pin: "1234" });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 for invalid PIN format", async () => {
        const { tokens, user } = await seedVerifiedUser();

        const res = await request(app)
            .post(`/api/v1/user/${user.id}/pin/verify`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ pin: "abc" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 on success", async () => {
        const { tokens, user } = await seedVerifiedUser();

        const res = await request(app)
            .post(`/api/v1/user/${user.id}/pin/verify`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ pin: "1234" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.message).toBe("PIN verified successfully.");
        expect(userService.verifyPin).toHaveBeenCalledWith(user.id, "1234");
    });
});

describe("POST /api/v1/user/:id/pin/reset", () => {
    it("returns 401 without auth", async () => {
        const { user } = await seedVerifiedUser();

        const res = await request(app).post(`/api/v1/user/${user.id}/pin/reset`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when requesting reset for another user", async () => {
        const { tokens } = await seedVerifiedUser();
        const { user: other } = await seedSecondVerifiedUser();

        const res = await request(app).post(`/api/v1/user/${other.id}/pin/reset`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 503 when email service is disabled", async () => {
        const { tokens, user } = await seedVerifiedUser();

        const res = await request(app).post(`/api/v1/user/${user.id}/pin/reset`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(503);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 on success when email is enabled", async () => {
        settings.emailEnabled = true;
        const { tokens, user } = await seedVerifiedUser();

        const res = await request(app).post(`/api/v1/user/${user.id}/pin/reset`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.message).toBe("PIN reset email has been sent.");
        expect(userService.requestPinReset).toHaveBeenCalledWith(user.id);
    });
});

describe("PATCH /api/v1/user/pin/reset", () => {
    it("returns 400 when token is missing", async () => {
        const res = await request(app).patch("/api/v1/user/pin/reset").send({ pin: "1234" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 for invalid PIN format", async () => {
        const res = await request(app).patch("/api/v1/user/pin/reset").send({ pin: "abc", token: "valid-token" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 on success", async () => {
        const res = await request(app).patch("/api/v1/user/pin/reset").send({ pin: "1234", token: "valid-token" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.message).toBe("PIN has been reset successfully.");
        expect(userService.resetPin).toHaveBeenCalledWith("1234", "valid-token");
    });
});
