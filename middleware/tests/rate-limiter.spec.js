jest.mock("@modules/database", () => ({
    dbGet: jest.fn(),
}));

jest.mock("@services/api-key-service", () => ({
    resolveAPIKey: jest.fn(),
}));

jest.mock("@services/user-service", () => ({
    getUserDataFromDb: jest.fn(),
}));

jest.mock("@services/auth-service", () => ({
    verifyToken: jest.fn(),
}));

jest.mock("@modules/config", () => ({
    settings: {
        rateLimitWindowMs: 60000,
        rateLimitMultiplier: 0.04,
    },
}));

jest.mock("@modules/permissions", () => ({
    computeGlobalPermissionLevel: jest.fn(() => 0),
    STUDENT_PERMISSIONS: 2,
    TEACHER_PERMISSIONS: 4,
}));

jest.mock("@modules/scope-resolver", () => ({
    getUserScopes: jest.fn(() => ({ global: [], class: [] })),
}));

const { rateLimiter, getBucketKeyToEvict } = require("@middleware/rate-limiter");
const { resolveAPIKey } = require("@services/api-key-service");
const { getUserDataFromDb } = require("@services/user-service");
const { verifyToken } = require("@services/auth-service");
const { dbGet } = require("@modules/database");

function createReq({ api, authorization, path = "/api/v1/example", ip = "127.0.0.1" }) {
    return {
        headers: {
            ...(api !== undefined ? { api } : {}),
            ...(authorization !== undefined ? { authorization } : {}),
        },
        path,
        ip,
        body: {},
        query: {},
        warnEvent: jest.fn(),
    };
}

function createRes() {
    return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
    };
}

describe("HTTP rate-limiter middleware", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("keys authenticated buckets by user id instead of email", async () => {
        resolveAPIKey.mockResolvedValue({ id: 42, email: "api-user@example.com" });
        verifyToken.mockReturnValue({ email: "token-user@example.com" });
        dbGet.mockResolvedValue({ id: 42 });
        getUserDataFromDb.mockResolvedValue({ id: 42, email: "token-user@example.com", roles: { global: [], class: [] } });

        const apiReq = createReq({ api: "api-key-1" });
        const apiRes = createRes();
        const apiNext = jest.fn();
        await rateLimiter(apiReq, apiRes, apiNext);

        expect(apiNext).toHaveBeenCalledTimes(1);
        expect(apiRes.status).not.toHaveBeenCalled();

        const tokenReq = createReq({ authorization: "token-1" });
        const tokenRes = createRes();
        const tokenNext = jest.fn();
        await rateLimiter(tokenReq, tokenRes, tokenNext);

        expect(tokenNext).not.toHaveBeenCalled();
        expect(tokenRes.status).toHaveBeenCalledWith(429);
        expect(tokenRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.stringContaining("Please try again"),
            })
        );
    });

    it("does not choose the current path or global bucket for path bucket eviction", () => {
        const keyToEvict = getBucketKeyToEvict(
            {
                __global__: [1],
                "/api/v1/current": [],
                hasBeenMessaged: false,
                "/api/v1/old": [1],
            },
            "/api/v1/current",
            "__global__"
        );

        expect(keyToEvict).toBe("/api/v1/old");
    });

    it("skips eviction when only protected buckets are present", () => {
        const keyToEvict = getBucketKeyToEvict(
            {
                __global__: [1],
                "/api/v1/current": [],
                hasBeenMessaged: false,
            },
            "/api/v1/current",
            "__global__"
        );

        expect(keyToEvict).toBeUndefined();
    });
});
