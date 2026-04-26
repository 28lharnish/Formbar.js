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
        rateLimit: {
            maxAttempts: 5,
            lockoutDuration: 900000,
            minDelayBetweenAttempts: 1000,
            attemptWindow: 300000,
        },
    };
});

const registerAppController = require("../apps/register-app");

const app = createTestApp(registerAppController);

beforeAll(async () => {
    mockDatabase = await createTestDb();
    await mockDatabase.dbRun(`CREATE TABLE IF NOT EXISTS apps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        owner_user_id INTEGER NOT NULL,
        share_item_id INTEGER NOT NULL,
        pool_id INTEGER NOT NULL,
        api_key_hash TEXT NOT NULL UNIQUE,
        api_secret_hash TEXT NOT NULL
    )`);
});

afterEach(async () => {
    await mockDatabase.dbRun("DELETE FROM apps");
    await mockDatabase.reset();
    clearClassStateStore();
    jest.clearAllMocks();
});

afterAll(async () => {
    await mockDatabase.close();
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

    it("creates an app, pool, and share item on success", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app)
            .post("/api/v1/apps/register")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ name: "My App", description: "A test app" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.appId).toBeGreaterThan(0);
        expect(res.body.data.apiKey).toMatch(/^[0-9a-f]{128}$/);
        expect(res.body.data.apiSecret).toMatch(/^[0-9a-f]{512}$/);

        const appRow = await mockDatabase.dbGet("SELECT * FROM apps WHERE id = ?", [res.body.data.appId]);
        expect(appRow.name).toBe("My App");
        expect(appRow.owner_user_id).toBe(user.id);
        expect(appRow.api_key_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(appRow.api_secret_hash).toMatch(/^[0-9a-f]{64}$/);

        const shareItem = await mockDatabase.dbGet("SELECT * FROM item_registry WHERE id = ?", [appRow.share_item_id]);
        expect(shareItem.name).toBe("My App Share");

        const pool = await mockDatabase.dbGet("SELECT * FROM digipog_pools WHERE id = ?", [appRow.pool_id]);
        expect(pool.name).toBe("My App Developer Pool");
    });

    it("allows multiple apps to share the same name without collisions", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase);
        const headers = { Authorization: `Bearer ${tokens.accessToken}` };
        const payload = { name: "Same Name", description: "First app" };

        const first = await request(app).post("/api/v1/apps/register").set(headers).send(payload);
        const second = await request(app).post("/api/v1/apps/register").set(headers).send({ name: payload.name, description: "Second app" });

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(first.body.success).toBe(true);
        expect(second.body.success).toBe(true);
        expect(first.body.data.appId).not.toBe(second.body.data.appId);
        expect(first.body.data.apiKey).not.toBe(second.body.data.apiKey);
        expect(first.body.data.apiSecret).not.toBe(second.body.data.apiSecret);

        const apps = await mockDatabase.dbGetAll("SELECT id, name, description, owner_user_id FROM apps WHERE owner_user_id = ? ORDER BY id", [
            user.id,
        ]);
        expect(apps).toHaveLength(2);
        expect(apps.every((row) => row.name === payload.name)).toBe(true);

        const shareItemRows = await mockDatabase.dbGetAll("SELECT id, name FROM item_registry WHERE name = ?", [`${payload.name} Share`]);
        expect(shareItemRows).toHaveLength(2);

        const poolRows = await mockDatabase.dbGetAll("SELECT id, name FROM digipog_pools WHERE name = ?", [`${payload.name} Developer Pool`]);
        expect(poolRows).toHaveLength(2);
    });
});
