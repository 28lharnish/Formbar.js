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

const { sha256 } = require("@modules/crypto");
const { apiKeyCacheStore } = require("@stores/api-key-cache-store");
const { resolveAPIKey, regenerateAPIKey } = require("@services/api-key-service");
const ValidationError = require("@errors/validation-error");
const NotFoundError = require("@errors/not-found-error");

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
    const userId = await mockDatabase.dbRun("INSERT INTO users (email, password, secret, displayName, digipogs, verified) VALUES (?, ?, ?, ?, ?, ?)", [
        email,
        "hashed-password",
        `${email}-secret`,
        email,
        0,
        1,
    ]);

    await mockDatabase.dbRun("INSERT INTO api_keys (api_key_hash, entity_id, entity_type) VALUES (?, ?, ?)", [apiHash, userId, "user"]);

    return userId;
}

jest.mock("@stores/api-key-cache-store", () => ({
    apiKeyCacheStore: {
        invalidateByAPIKey: jest.fn(),
        invalidateByEntity: jest.fn(),
        clear: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
    },
}));

describe("regenerateAPIKey()", () => {
    it("throws ValidationError when userId is missing", async () => {
        await expect(regenerateAPIKey(null, null)).rejects.toThrow(ValidationError);
        await expect(regenerateAPIKey(undefined, undefined)).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError for non-existent user", async () => {
        await expect(regenerateAPIKey("user", 99999)).rejects.toThrow(NotFoundError);
    });

    it("returns a new plaintext API key and stores a sha256 hash", async () => {
        const userId = await seedUser(sha256("oldapi"), "api-key-user@test.com");
        const newKey = await regenerateAPIKey("user", userId);

        expect(typeof newKey).toBe("string");
        expect(newKey.length).toBe(64);

        const row = await mockDatabase.dbGet("SELECT api_key_hash FROM api_keys WHERE entity_id = ? AND entity_type = ?", [userId, "user"]);
        expect(row.api_key_hash).not.toBe("oldapi");
        expect(row.api_key_hash).not.toBe(newKey);
        expect(row.api_key_hash).toBe(sha256(newKey));
    });
});

describe("resolveAPIKey()", () => {
    it("resolves sha256 API keys with a direct lookup", async () => {
        const apiKey = "sha-key";
        const userId = await seedUser(sha256(apiKey));

        const user = await resolveAPIKey(apiKey);

        expect(user).toEqual(expect.objectContaining({ id: userId, email: "api-key-user@test.com", migrated: false }));
    });

    it("does not trust a stale cache entry after the stored hash changes", async () => {
        await seedUser(sha256("new-key"), "rotated-api-key@test.com");
        apiKeyCacheStore.set("old-key", "rotated-api-key@test.com");

        const user = await resolveAPIKey("old-key");

        expect(user).toBeNull();
    });
});
