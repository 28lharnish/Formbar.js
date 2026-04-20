const request = require("supertest");
const { createTestDb } = require("@test-helpers/db");
const { createTestApp, clearClassStateStore } = require("./helpers/test-app");

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

jest.mock("@services/user-service", () => ({
    ...jest.requireActual("@services/user-service"),
    getUser: jest.fn(),
}));

jest.mock("@modules/scope-resolver", () => ({
    ...jest.requireActual("@modules/scope-resolver"),
    userHasScope: jest.fn().mockReturnValue(true),
}));

const { getUser } = require("@services/user-service");
const { userHasScope } = require("@modules/scope-resolver");
const { classStateStore } = require("@services/classroom-service");

const apiPermissionCheckController = require("../api-permission-check");
const app = createTestApp(apiPermissionCheckController);

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    clearClassStateStore();
    jest.clearAllMocks();
    userHasScope.mockReturnValue(true);
});

afterAll(async () => {
    await mockDatabase.close();
});

function seedClassroom(classId = 42) {
    classStateStore.setClassroom(classId, {
        classId,
        className: "Test Class",
        isActive: true,
        owner: 999,
        students: {
            "test@example.com": {
                email: "test@example.com",
                permissions: 2,
                scopes: {},
            },
        },
        key: "ABCD",
        poll: null,
        tags: [],
        settings: {},
        timer: {},
        permissions: { games: 2, auxiliary: 3 },
    });
}

function mockLoggedInUser(overrides = {}) {
    const user = {
        loggedIn: true,
        classId: 42,
        email: "test@example.com",
        id: 1,
        ...overrides,
    };
    getUser.mockResolvedValue(user);
    return user;
}

describe("GET /api/v1/apiPermissionCheck", () => {
    it("returns 400 when api query param is missing", async () => {
        const res = await request(app).get("/api/v1/apiPermissionCheck").query({ permissionType: "games", classId: 42 });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when permissionType is missing", async () => {
        const res = await request(app).get("/api/v1/apiPermissionCheck").query({ api: "some-api-key", classId: 42 });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when classId is missing", async () => {
        const res = await request(app).get("/api/v1/apiPermissionCheck").query({ api: "some-api-key", permissionType: "games" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 for invalid permissionType", async () => {
        const res = await request(app).get("/api/v1/apiPermissionCheck").query({ api: "some-api-key", permissionType: "invalid", classId: 42 });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when user is not logged in", async () => {
        getUser.mockResolvedValue({ loggedIn: false, classId: null, email: null, id: 1 });

        const res = await request(app).get("/api/v1/apiPermissionCheck").query({ api: "some-api-key", permissionType: "games", classId: 42 });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when user is not in any class", async () => {
        mockLoggedInUser({ classId: null });

        const res = await request(app).get("/api/v1/apiPermissionCheck").query({ api: "some-api-key", permissionType: "games", classId: 42 });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when user is not in the requested class", async () => {
        mockLoggedInUser({ classId: 99 });
        seedClassroom(99);

        const res = await request(app).get("/api/v1/apiPermissionCheck").query({ api: "some-api-key", permissionType: "games", classId: 42 });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when user doesn't have enough permissions", async () => {
        mockLoggedInUser();
        seedClassroom();
        userHasScope.mockReturnValue(false);

        const res = await request(app).get("/api/v1/apiPermissionCheck").query({ api: "some-api-key", permissionType: "games", classId: 42 });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 with allowed: true on success", async () => {
        mockLoggedInUser();
        seedClassroom();

        const res = await request(app).get("/api/v1/apiPermissionCheck").query({ api: "some-api-key", permissionType: "games", classId: 42 });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            success: true,
            data: { allowed: true },
        });
    });
});
