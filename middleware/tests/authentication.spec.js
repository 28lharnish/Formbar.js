const { createTestDb } = require("@test-helpers/db");

let mockDatabase;

jest.mock("@modules/database", () => ({
    dbGet: (...args) => mockDatabase.dbGet(...args),
    dbRun: (...args) => mockDatabase.dbRun(...args),
}));

const mockCleanupExpiredAuthorizationCodes = jest.fn().mockResolvedValue();

jest.mock("@services/auth-service", () => ({
    cleanupExpiredAuthorizationCodes: (...args) => mockCleanupExpiredAuthorizationCodes(...args),
    verifyToken: jest.fn(),
}));

jest.mock("@modules/logger", () => ({
    getLogger: jest.fn().mockResolvedValue({
        error: jest.fn(),
    }),
}));

jest.mock("@modules/config", () => ({
    settings: { emailEnabled: false },
}));

const { cleanRefreshTokens } = require("@middleware/authentication");

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    mockCleanupExpiredAuthorizationCodes.mockClear();
});

afterAll(async () => {
    await mockDatabase.close();
});

describe("cleanRefreshTokens()", () => {
    it("deletes only refresh tokens whose exp has passed in JWT seconds", async () => {
        const nowInSeconds = Math.floor(Date.now() / 1000);

        await mockDatabase.dbRun("INSERT INTO refresh_tokens (user_id, token_hash, exp, token_type) VALUES (?, ?, ?, ?)", [
            1,
            "expired-token",
            nowInSeconds - 1,
            "auth",
        ]);
        await mockDatabase.dbRun("INSERT INTO refresh_tokens (user_id, token_hash, exp, token_type) VALUES (?, ?, ?, ?)", [
            1,
            "active-token",
            nowInSeconds + 3600,
            "auth",
        ]);

        await cleanRefreshTokens();

        const remaining = await mockDatabase.dbGetAll("SELECT token_hash FROM refresh_tokens ORDER BY token_hash");
        expect(remaining).toEqual([{ token_hash: "active-token" }]);
        expect(mockCleanupExpiredAuthorizationCodes).toHaveBeenCalledTimes(1);
    });
});
