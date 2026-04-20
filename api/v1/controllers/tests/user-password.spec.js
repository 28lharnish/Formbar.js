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
    resetPassword: jest.fn().mockResolvedValue(undefined),
    requestPasswordReset: jest.fn().mockResolvedValue(undefined),
}));

const { settings } = require("@modules/config");
const userService = require("@services/user-service");
const passwordController = require("../user/me/password");
const app = createTestApp(passwordController);

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

describe("PATCH /api/v1/user/me/password", () => {
    it("returns 400 when password is missing", async () => {
        const res = await request(app).patch("/api/v1/user/me/password").send({ token: "some-token" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when token is missing", async () => {
        const res = await request(app).patch("/api/v1/user/me/password").send({ password: "NewPass1!", confirmPassword: "NewPass1!" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when passwords do not match", async () => {
        const res = await request(app)
            .patch("/api/v1/user/me/password")
            .send({ password: "NewPass1!", confirmPassword: "DifferentPass1!", token: "some-token" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 on success", async () => {
        const res = await request(app)
            .patch("/api/v1/user/me/password")
            .send({ password: "NewPass1!", confirmPassword: "NewPass1!", token: "valid-token" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.message).toBe("Password has been reset successfully.");
        expect(userService.resetPassword).toHaveBeenCalledWith("NewPass1!", "valid-token");
    });
});

describe("POST /api/v1/user/me/password/reset", () => {
    it("returns 400 when email is missing", async () => {
        const res = await request(app).post("/api/v1/user/me/password/reset").send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 503 when email service is disabled", async () => {
        const res = await request(app).post("/api/v1/user/me/password/reset").send({ email: "test@example.com" });

        expect(res.status).toBe(503);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 on success when email is enabled", async () => {
        settings.emailEnabled = true;

        const res = await request(app).post("/api/v1/user/me/password/reset").send({ email: "test@example.com" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.message).toBe("Password reset email has been sent.");
        expect(userService.requestPasswordReset).toHaveBeenCalledWith("test@example.com");
    });
});
