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

jest.mock("@services/app-service", () => ({
    createApp: jest.fn(),
}));

const authorizeController = require("../oauth/authorize");
const tokenController = require("../oauth/token");
const revokeController = require("../oauth/revoke");
const registerAppController = require("../apps/register-app");
const appService = require("@services/app-service");

const app = createTestApp(authorizeController, tokenController, revokeController, registerAppController);

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

describe("GET /api/v1/oauth/authorize", () => {
    it("returns 401 without an authorization header", async () => {
        const res = await request(app).get("/api/v1/oauth/authorize");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when client_id is missing", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app)
            .get("/api/v1/oauth/authorize")
            .set("Authorization", tokens.accessToken)
            .query({ redirect_uri: "http://localhost:4000/cb", scope: "read", state: "xyz" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toMatch(/client_id/i);
    });

    it("returns 400 when redirect_uri is missing", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app)
            .get("/api/v1/oauth/authorize")
            .set("Authorization", tokens.accessToken)
            .query({ client_id: "app123", scope: "read", state: "xyz" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toMatch(/redirect_uri/i);
    });

    it("returns 400 when scope is missing", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app)
            .get("/api/v1/oauth/authorize")
            .set("Authorization", tokens.accessToken)
            .query({ client_id: "app123", redirect_uri: "http://localhost:4000/cb", state: "xyz" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toMatch(/scope/i);
    });

    it("returns 400 when state is missing", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app)
            .get("/api/v1/oauth/authorize")
            .set("Authorization", tokens.accessToken)
            .query({ client_id: "app123", redirect_uri: "http://localhost:4000/cb", scope: "read" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toMatch(/state/i);
    });

    it("returns 400 for unsupported response_type", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).get("/api/v1/oauth/authorize").set("Authorization", tokens.accessToken).query({
            response_type: "token",
            client_id: "app123",
            redirect_uri: "http://localhost:4000/cb",
            scope: "read",
            state: "xyz",
        });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toMatch(/response_type/i);
    });

    it("redirects (302) with a valid authorization code when all params are present", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).get("/api/v1/oauth/authorize").set("Authorization", tokens.accessToken).query({
            client_id: "app123",
            redirect_uri: "http://localhost:4000/cb",
            scope: "read",
            state: "xyz",
        });

        expect(res.status).toBe(302);
        const location = new URL(res.headers.location);
        expect(location.origin + location.pathname).toBe("http://localhost:4000/cb");
        expect(location.searchParams.get("state")).toBe("xyz");
        expect(location.searchParams.get("code")).toBeTruthy();
    });
});

describe("POST /api/v1/oauth/token", () => {
    it("returns 400 when grant_type is missing", async () => {
        const res = await request(app).post("/api/v1/oauth/token").send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toMatch(/grant_type/i);
    });

    it("returns 400 for an invalid grant_type", async () => {
        const res = await request(app).post("/api/v1/oauth/token").send({ grant_type: "client_credentials" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toMatch(/grant_type/i);
    });

    it("returns 400 when code is missing for authorization_code grant", async () => {
        const res = await request(app)
            .post("/api/v1/oauth/token")
            .send({ grant_type: "authorization_code", redirect_uri: "http://localhost:4000/cb", client_id: "app123" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toMatch(/code/i);
    });

    it("returns 400 when redirect_uri is missing for authorization_code grant", async () => {
        const res = await request(app).post("/api/v1/oauth/token").send({ grant_type: "authorization_code", code: "bad-code", client_id: "app123" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toMatch(/redirect_uri/i);
    });

    it("returns 400 when client_id is missing for authorization_code grant", async () => {
        const res = await request(app)
            .post("/api/v1/oauth/token")
            .send({ grant_type: "authorization_code", code: "bad-code", redirect_uri: "http://localhost:4000/cb" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toMatch(/client_id/i);
    });

    it("returns 400 for an invalid authorization code", async () => {
        const res = await request(app).post("/api/v1/oauth/token").send({
            grant_type: "authorization_code",
            code: "invalid-code",
            redirect_uri: "http://localhost:4000/cb",
            client_id: "app123",
        });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("exchanges a valid authorization code for tokens", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        // Step 1: obtain an authorization code via the authorize endpoint
        const authRes = await request(app).get("/api/v1/oauth/authorize").set("Authorization", tokens.accessToken).query({
            client_id: "app123",
            redirect_uri: "http://localhost:4000/cb",
            scope: "read",
            state: "xyz",
        });

        const code = new URL(authRes.headers.location).searchParams.get("code");

        // Step 2: exchange the code for tokens
        const res = await request(app).post("/api/v1/oauth/token").send({
            grant_type: "authorization_code",
            code,
            redirect_uri: "http://localhost:4000/cb",
            client_id: "app123",
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("access_token");
        expect(res.body.data).toHaveProperty("refresh_token");
        expect(res.body.data.token_type).toBe("Bearer");
        expect(res.body.data.expires_in).toBe(900);
    });

    it("returns 400 when the same authorization code is reused", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const authRes = await request(app).get("/api/v1/oauth/authorize").set("Authorization", tokens.accessToken).query({
            client_id: "app123",
            redirect_uri: "http://localhost:4000/cb",
            scope: "read",
            state: "xyz",
        });

        const code = new URL(authRes.headers.location).searchParams.get("code");

        // First exchange — should succeed
        await request(app)
            .post("/api/v1/oauth/token")
            .send({ grant_type: "authorization_code", code, redirect_uri: "http://localhost:4000/cb", client_id: "app123" });

        // Second exchange — should fail
        const res = await request(app)
            .post("/api/v1/oauth/token")
            .send({ grant_type: "authorization_code", code, redirect_uri: "http://localhost:4000/cb", client_id: "app123" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when refresh_token is missing for refresh_token grant", async () => {
        const res = await request(app).post("/api/v1/oauth/token").send({ grant_type: "refresh_token" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toMatch(/refresh_token/i);
    });
});

describe("POST /api/v1/oauth/revoke", () => {
    it("returns 200 even when no token is provided (prevents enumeration)", async () => {
        const res = await request(app).post("/api/v1/oauth/revoke").send({});

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("returns 200 for a non-existent token (prevents enumeration)", async () => {
        const res = await request(app).post("/api/v1/oauth/revoke").send({ token: "non-existent-token" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("successfully revokes a valid OAuth refresh token", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        // Obtain an OAuth refresh token via the full authorize → token flow
        const authRes = await request(app).get("/api/v1/oauth/authorize").set("Authorization", tokens.accessToken).query({
            client_id: "app123",
            redirect_uri: "http://localhost:4000/cb",
            scope: "read",
            state: "xyz",
        });

        const code = new URL(authRes.headers.location).searchParams.get("code");

        const tokenRes = await request(app).post("/api/v1/oauth/token").send({
            grant_type: "authorization_code",
            code,
            redirect_uri: "http://localhost:4000/cb",
            client_id: "app123",
        });

        const oauthRefreshToken = tokenRes.body.data.refresh_token;

        // Revoke the refresh token
        const revokeRes = await request(app).post("/api/v1/oauth/revoke").send({ token: oauthRefreshToken });

        expect(revokeRes.status).toBe(200);
        expect(revokeRes.body.success).toBe(true);

        // Attempting to use the revoked refresh token should fail
        const refreshRes = await request(app).post("/api/v1/oauth/token").send({ grant_type: "refresh_token", refresh_token: oauthRefreshToken });

        expect(refreshRes.status).toBeGreaterThanOrEqual(400);
        expect(refreshRes.body.success).toBe(false);
    });
});

describe("POST /api/v1/apps/register", () => {
    it("returns 401 without an authorization header", async () => {
        const res = await request(app).post("/api/v1/apps/register").send({ name: "My App", description: "A test app" });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when name is missing", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app)
            .post("/api/v1/apps/register")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ description: "A test app" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when description is missing", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).post("/api/v1/apps/register").set("Authorization", `Bearer ${tokens.accessToken}`).send({ name: "My App" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when name exceeds 100 characters", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app)
            .post("/api/v1/apps/register")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ name: "A".repeat(101), description: "A test app" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when description exceeds 500 characters", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app)
            .post("/api/v1/apps/register")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ name: "My App", description: "A".repeat(501) });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 with appId, apiKey, and apiSecret on success", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        appService.createApp.mockResolvedValue({
            appId: 42,
            apiKey: "generated-api-key",
            apiSecret: "generated-api-secret",
        });

        const res = await request(app)
            .post("/api/v1/apps/register")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ name: "My App", description: "A test app" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({
            appId: 42,
            apiKey: "generated-api-key",
            apiSecret: "generated-api-secret",
        });
    });
});
