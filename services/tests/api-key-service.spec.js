const { createTestDb } = require("@test-helpers/db");

let mockDatabase;

jest.mock("@modules/database", () => ({
    get database() {
        return mockDatabase && mockDatabase.db;
    },
    dbGet: (...args) => mockDatabase.dbGet(...args),
    dbRun: (...args) => mockDatabase.dbRun(...args),
    dbGetAll: (...args) => mockDatabase.dbGetAll(...args),
}));

const { hashBcrypt, sha256 } = require("@modules/crypto");
const { apiKeyCacheStore } = require("@stores/api-key-cache-store");
const { resolveAPIKey } = require("@services/api-key-service");

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    apiKeyCacheStore.clear();
});

afterAll(async () => {
    await mockDatabase.close();
});

async function seedUser(apiHash, email = "api-key-user@test.com") {
    return mockDatabase.dbRun("INSERT INTO users (email, password, API, secret, displayName, digipogs, verified) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        email,
        "hashed-password",
        apiHash,
        `${email}-secret`,
        email,
        0,
        1,
    ]);
}

describe("resolveAPIKey()", () => {
    it("resolves sha256 API keys with a direct lookup", async () => {
        const apiKey = "sha-key";
        const userId = await seedUser(sha256(apiKey));

        const user = await resolveAPIKey(apiKey);

        expect(user).toEqual(expect.objectContaining({ id: userId, email: "api-key-user@test.com", migrated: false }));
    });

    it("migrates a matching bcrypt API key to sha256", async () => {
        const apiKey = "legacy-api-key";
        const legacyHash = await hashBcrypt(apiKey);
        const userId = await seedUser(legacyHash, "legacy-api-key@test.com");

        const user = await resolveAPIKey(apiKey);

        expect(user).toEqual(expect.objectContaining({ id: userId, email: "legacy-api-key@test.com", migrated: true }));
        const row = await mockDatabase.dbGet("SELECT API FROM users WHERE id = ?", [userId]);
        expect(row.API).toBe(sha256(apiKey));
    });

    it("does not trust a stale cache entry after the stored hash changes", async () => {
        await seedUser(sha256("new-key"), "rotated-api-key@test.com");
        apiKeyCacheStore.set("old-key", "rotated-api-key@test.com");

        const user = await resolveAPIKey("old-key");

        expect(user).toBeNull();
    });
});
