const request = require("supertest");
const { createTestDb } = require("@test-helpers/db");
const { createTestApp, clearClassStateStore } = require("./helpers/test-app");
const { classStateStore } = require("@services/classroom-service");
const { GUEST_PERMISSIONS } = require("@modules/permissions");

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

const loginController = require("../auth/login");
const registerController = require("../auth/register");
const refreshController = require("../auth/refresh");
const guestController = require("../auth/guest");

const app = createTestApp(loginController, registerController, refreshController, guestController);

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

describe("POST /api/v1/auth/register", () => {
    it("returns 201 with tokens and user data on valid registration", async () => {
        const res = await request(app).post("/api/v1/auth/register").send({
            email: "new@example.com",
            password: "TestPass1!",
            displayName: "NewUser",
        });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("accessToken");
        expect(res.body.data).toHaveProperty("refreshToken");
        expect(res.body.data.user).toMatchObject({
            email: "new@example.com",
            displayName: "NewUser",
        });
        expect(res.body.data.user).toHaveProperty("id");
    });

    it("returns 400 when email is missing", async () => {
        const res = await request(app).post("/api/v1/auth/register").send({
            password: "TestPass1!",
            displayName: "NewUser",
        });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when password is missing", async () => {
        const res = await request(app).post("/api/v1/auth/register").send({
            email: "new@example.com",
            displayName: "NewUser",
        });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when displayName is missing", async () => {
        const res = await request(app).post("/api/v1/auth/register").send({
            email: "new@example.com",
            password: "TestPass1!",
        });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 for an invalid password format", async () => {
        const res = await request(app).post("/api/v1/auth/register").send({
            email: "new@example.com",
            password: "ab",
            displayName: "NewUser",
        });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 409 for a duplicate email", async () => {
        await request(app).post("/api/v1/auth/register").send({
            email: "dup@example.com",
            password: "TestPass1!",
            displayName: "First1",
        });

        const res = await request(app).post("/api/v1/auth/register").send({
            email: "dup@example.com",
            password: "TestPass1!",
            displayName: "Second",
        });

        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
    });
});

describe("POST /api/v1/auth/login", () => {
    const email = "login@example.com";
    const password = "TestPass1!";
    const displayName = "LoginUser";

    beforeEach(async () => {
        await request(app).post("/api/v1/auth/register").send({ email, password, displayName });
    });

    it("returns 200 with tokens on valid credentials", async () => {
        const res = await request(app).post("/api/v1/auth/login").send({ email, password });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("accessToken");
        expect(res.body.data).toHaveProperty("refreshToken");
    });

    it("returns 400 when email is missing", async () => {
        const res = await request(app).post("/api/v1/auth/login").send({ password });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when password is missing", async () => {
        const res = await request(app).post("/api/v1/auth/login").send({ email });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 for incorrect password", async () => {
        const res = await request(app).post("/api/v1/auth/login").send({ email, password: "WrongPass1!" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 for a non-existent user", async () => {
        const res = await request(app).post("/api/v1/auth/login").send({
            email: "nobody@example.com",
            password: "TestPass1!",
        });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});

describe("POST /api/v1/auth/refresh", () => {
    let refreshToken;

    beforeEach(async () => {
        const reg = await request(app).post("/api/v1/auth/register").send({
            email: "refresh@example.com",
            password: "TestPass1!",
            displayName: "RefUser",
        });
        refreshToken = reg.body.data.refreshToken;
    });

    it("returns 200 with new tokens on valid refresh token", async () => {
        const res = await request(app).post("/api/v1/auth/refresh").send({ token: refreshToken });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("accessToken");
        expect(res.body.data).toHaveProperty("refreshToken");
    });

    it("returns 400 when token is missing", async () => {
        const res = await request(app).post("/api/v1/auth/refresh").send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 for an invalid refresh token", async () => {
        const res = await request(app).post("/api/v1/auth/refresh").send({ token: "invalid-token" });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 when refresh token is reused after rotation", async () => {
        // Use the refresh token once
        await request(app).post("/api/v1/auth/refresh").send({ token: refreshToken });

        // Try to use the same token again (should fail — token was rotated)
        const res = await request(app).post("/api/v1/auth/refresh").send({ token: refreshToken });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

describe("POST /api/v1/auth/guest", () => {
    it("returns 200 with an access token and sanitized guest user data", async () => {
        const res = await request(app).post("/api/v1/auth/guest").send({
            displayName: "Guest<> Name!!!",
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("accessToken");
        expect(res.body.data.user).toMatchObject({
            displayName: "Guest Name",
            isGuest: true,
            digipogs: 0,
            permissions: GUEST_PERMISSIONS,
        });
        expect(res.body.data.user.email).toMatch(/^guest_.+@guest\.local$/);

        const storedGuest = classStateStore.getUser(res.body.data.user.email);
        expect(storedGuest).toMatchObject({
            email: res.body.data.user.email,
            displayName: "Guest Name",
            isGuest: true,
        });
    });

    it("returns 400 when displayName is missing", async () => {
        const res = await request(app).post("/api/v1/auth/guest").send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});
