const request = require("supertest");
const { createTestDb } = require("@test-helpers/db");
const { classStateStore } = require("@services/classroom-service");
const { createTestApp, seedAuthenticatedUser, seedClassMembership, clearClassStateStore } = require("./helpers/test-app");
const { setGlobalPermissionLevel } = require("@test-helpers/role-seeding");
const { loginAsGuest } = require("@services/auth-service");
const { createStudentFromUserData } = require("@services/student-service");

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

// Socket-updates-service emits to sockets that don't exist in tests — stub it out.
jest.mock("@services/socket-updates-service", () => ({
    managerUpdate: jest.fn().mockResolvedValue(),
    userUpdateSocket: jest.fn(),
}));

jest.mock("@services/user-service", () => ({
    ...jest.requireActual("@services/user-service"),
    regenerateAPIKey: jest.fn().mockResolvedValue("new-api-key-123"),
}));

const userService = require("@services/user-service");
const userController = require("../user/user");
const meController = require("../user/me/me");
const banController = require("../user/ban");
const deleteController = require("../user/delete");
const permController = require("../user/perm");
const classesController = require("../user/classes");
const scopesController = require("../user/scopes");
const transactionsController = require("../user/transactions");
const poolsController = require("../user/pools");
const classController = require("../user/class");
const apiRegenerateController = require("../user/api/regenerate");

// meController must be registered before userController so that
// the literal "/user/me" route matches before the "/user/:id" param route.
const app = createTestApp(
    meController,
    userController,
    banController,
    deleteController,
    permController,
    classesController,
    scopesController,
    transactionsController,
    poolsController,
    classController,
    apiRegenerateController
);

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

async function seedManager() {
    return seedAuthenticatedUser(mockDatabase, {
        email: "admin@example.com",
        displayName: "Admin1",
        permissions: 5,
    });
}

async function seedStudent() {
    // Explicitly set permissions=2 because the register() service grants the
    // first user MANAGER_PERMISSIONS (5). Without the override, a student
    // seeded first would silently become a manager.
    return seedAuthenticatedUser(mockDatabase, { permissions: 2 });
}

async function seedSecondStudent() {
    return seedAuthenticatedUser(mockDatabase, {
        email: "student2@example.com",
        displayName: "Student2",
        permissions: 2,
    });
}

describe("GET /api/v1/user/:id", () => {
    it("returns 200 with own user data for an authenticated user", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toMatchObject({
            id: user.id,
            displayName: user.displayName,
        });
    });

    it("still returns 200 when the stored API key is null", async () => {
        const { tokens, user } = await seedStudent();
        const row = await mockDatabase.dbGet("SELECT API FROM users WHERE id = ?", [user.id]);

        expect(row.API).toBeNull();

        const res = await request(app).get(`/api/v1/user/${user.id}`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("returns 404 for a non-existent user", async () => {
        const { tokens } = await seedStudent();
        const res = await request(app).get("/api/v1/user/99999").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it("requires authentication", async () => {
        const { user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}`);

        expect(res.status).toBe(401);
    });

    it("exposes email for the authenticated user's own profile", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.email).toBe(user.email);
    });
});

describe("GET /api/v1/user/me", () => {
    it("returns 200 with the authenticated user's data", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app).get("/api/v1/user/me").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toMatchObject({
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            isGuest: false,
        });
    });

    it("returns classPermissions for the authenticated user's active class", async () => {
        const { tokens, user } = await seedStudent();
        await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", ["Test Class", user.id + 1000, "test-key"]);
        const classroom = await mockDatabase.dbGet("SELECT id, owner FROM classroom WHERE name = ?", ["Test Class"]);
        await seedClassMembership(mockDatabase, user.id, classroom.id, 4);

        const student = classStateStore.getUser(user.email);
        student.activeClass = classroom.id;

        classStateStore.setClassroom(classroom.id, {
            id: classroom.id,
            owner: classroom.owner,
            students: {
                [user.email]: {
                    email: user.email,
                    roles: { global: [], class: ["Teacher"] },
                },
            },
        });

        const res = await request(app).get("/api/v1/user/me").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.classPermissions).toBe(4);
    });

    it("returns teacher-panel access scopes for an active class owner with no explicit class roles", async () => {
        const { tokens, user } = await seedStudent();
        const classId = await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", ["Owner Class", user.id, "owner-key"]);

        const student = classStateStore.getUser(user.email);
        student.activeClass = classId;

        classStateStore.setClassroom(classId, {
            id: classId,
            owner: user.id,
            students: {},
        });

        const res = await request(app).get("/api/v1/user/me").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.classPermissions).toBe(5);
        expect(res.body.data.scopes.class).toEqual(expect.arrayContaining(["class.system.admin", "class.system.panel_access"]));
    });

    it("returns 401 without auth", async () => {
        const res = await request(app).get("/api/v1/user/me");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns guest data with digipogs from in-memory state", async () => {
        const guestUser = {
            id: 1000000001,
            email: "guest_1@guest.local",
            displayName: "Guest One",
            digipogs: 0,
            API: null,
            permissions: 1,
            isGuest: true,
        };
        classStateStore.setUser(guestUser.email, createStudentFromUserData(guestUser, { isGuest: true }));

        const { accessToken } = loginAsGuest(guestUser);
        const res = await request(app).get("/api/v1/user/me").set("Authorization", `Bearer ${accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toMatchObject({
            id: guestUser.id,
            email: guestUser.email,
            displayName: guestUser.displayName,
            digipogs: 0,
            isGuest: true,
        });
    });
});

describe("PATCH /api/v1/user/:id/ban", () => {
    it("returns 200 when a manager bans a user", async () => {
        const { tokens: managerTokens } = await seedManager();
        const { user: target } = await seedStudent();

        const res = await request(app).patch(`/api/v1/user/${target.id}/ban`).set("Authorization", `Bearer ${managerTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const row = await mockDatabase.dbGet(
            `SELECT r.name
             FROM user_roles ur
             JOIN roles r ON ur.roleId = r.id
             WHERE ur.userId = ? AND ur.classId IS NULL`,
            [target.id]
        );
        expect(row.name).toBe("Banned");
    });

    it("returns 404 when banning a non-existent user", async () => {
        const { tokens: managerTokens } = await seedManager();

        const res = await request(app).patch("/api/v1/user/99999/ban").set("Authorization", `Bearer ${managerTokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when a regular user tries to ban", async () => {
        const { tokens: studentTokens } = await seedStudent();
        const { user: target } = await seedSecondStudent();

        const res = await request(app).patch(`/api/v1/user/${target.id}/ban`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 without auth", async () => {
        const { user: target } = await seedStudent();

        const res = await request(app).patch(`/api/v1/user/${target.id}/ban`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

describe("PATCH /api/v1/user/:id/unban", () => {
    it("returns 200 when a manager unbans a user", async () => {
        const { tokens: managerTokens } = await seedManager();
        const { user: target } = await seedStudent();

        await setGlobalPermissionLevel(mockDatabase, target.id, 0);

        const res = await request(app).patch(`/api/v1/user/${target.id}/unban`).set("Authorization", `Bearer ${managerTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const row = await mockDatabase.dbGet(
            `SELECT r.name
             FROM user_roles ur
             JOIN roles r ON ur.roleId = r.id
             WHERE ur.userId = ? AND ur.classId IS NULL`,
            [target.id]
        );
        expect(row.name).toBe("Student");
    });

    it("returns 404 when unbanning a non-existent user", async () => {
        const { tokens: managerTokens } = await seedManager();

        const res = await request(app).patch("/api/v1/user/99999/unban").set("Authorization", `Bearer ${managerTokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when a regular user tries to unban", async () => {
        const { tokens: studentTokens } = await seedStudent();
        const { user: target } = await seedSecondStudent();

        const res = await request(app).patch(`/api/v1/user/${target.id}/unban`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 without auth", async () => {
        const { user: target } = await seedStudent();

        const res = await request(app).patch(`/api/v1/user/${target.id}/unban`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

describe("DELETE /api/v1/user/:id", () => {
    it("returns 200 when a manager deletes a user", async () => {
        const { tokens: managerTokens } = await seedManager();
        const { user: target } = await seedStudent();

        const res = await request(app).delete(`/api/v1/user/${target.id}`).set("Authorization", `Bearer ${managerTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify user no longer exists
        const row = await mockDatabase.dbGet("SELECT id FROM users WHERE id = ?", [target.id]);
        expect(row).toBeUndefined();
    });

    it("returns 403 when a regular user tries to delete", async () => {
        const { tokens: studentTokens } = await seedStudent();
        const { user: target } = await seedSecondStudent();

        const res = await request(app).delete(`/api/v1/user/${target.id}`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 without auth", async () => {
        const { user: target } = await seedStudent();

        const res = await request(app).delete(`/api/v1/user/${target.id}`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

describe("PATCH /api/v1/user/:id/perm", () => {
    it("returns 200 when a manager updates permissions", async () => {
        const { tokens: managerTokens } = await seedManager();
        const { user: target } = await seedStudent();

        const res = await request(app)
            .patch(`/api/v1/user/${target.id}/perm`)
            .set("Authorization", `Bearer ${managerTokens.accessToken}`)
            .send({ perm: 4 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const row = await mockDatabase.dbGet(
            `SELECT r.name
             FROM user_roles ur
             JOIN roles r ON ur.roleId = r.id
             WHERE ur.userId = ? AND ur.classId IS NULL`,
            [target.id]
        );
        expect(row.name).toBe("Teacher");
    });

    it("returns 400 when perm value is invalid", async () => {
        const { tokens: managerTokens } = await seedManager();
        const { user: target } = await seedStudent();

        const res = await request(app)
            .patch(`/api/v1/user/${target.id}/perm`)
            .set("Authorization", `Bearer ${managerTokens.accessToken}`)
            .send({ perm: "abc" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when a regular user tries to update permissions", async () => {
        const { tokens: studentTokens } = await seedStudent();
        const { user: target } = await seedSecondStudent();

        const res = await request(app)
            .patch(`/api/v1/user/${target.id}/perm`)
            .set("Authorization", `Bearer ${studentTokens.accessToken}`)
            .send({ perm: 4 });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 without auth", async () => {
        const { user: target } = await seedStudent();

        const res = await request(app).patch(`/api/v1/user/${target.id}/perm`).send({ perm: 4 });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

describe("GET /api/v1/user/:id/classes", () => {
    it("returns 200 when a user views their own classes", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/classes`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data.classes)).toBe(true);
        expect(res.body.data.pagination).toEqual({
            total: 0,
            limit: 20,
            offset: 0,
            hasMore: false,
        });
    });

    it("returns classPermissions on joined class entries", async () => {
        const { tokens, user } = await seedStudent();
        const ownerId = user.id + 1000;
        await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", ["Joined Class", ownerId, 5678]);
        const classroom = await mockDatabase.dbGet("SELECT id FROM classroom WHERE name = ?", ["Joined Class"]);
        await seedClassMembership(mockDatabase, user.id, classroom.id, 3);

        const res = await request(app).get(`/api/v1/user/${user.id}/classes`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.classes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: classroom.id,
                    permissions: 3,
                    classPermissions: 3,
                }),
            ])
        );
        expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it("paginates classes in stable id order across owned and joined classes", async () => {
        const { tokens, user } = await seedStudent();
        await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", ["Joined First", user.id + 1000, "joined-key"]);
        const joinedClass = await mockDatabase.dbGet("SELECT id FROM classroom WHERE name = ?", ["Joined First"]);
        await seedClassMembership(mockDatabase, user.id, joinedClass.id, 3);

        await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", ["Owned Second", user.id, "owned-key"]);
        const ownedClass = await mockDatabase.dbGet("SELECT id FROM classroom WHERE name = ?", ["Owned Second"]);

        const firstPage = await request(app)
            .get(`/api/v1/user/${user.id}/classes?limit=1&offset=0`)
            .set("Authorization", `Bearer ${tokens.accessToken}`);
        const secondPage = await request(app)
            .get(`/api/v1/user/${user.id}/classes?limit=1&offset=1`)
            .set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(firstPage.status).toBe(200);
        expect(secondPage.status).toBe(200);
        expect(firstPage.body.data.classes.map((classroom) => classroom.id)).toEqual([joinedClass.id]);
        expect(secondPage.body.data.classes.map((classroom) => classroom.id)).toEqual([ownedClass.id]);
    });

    it("returns 200 when a manager views another user's classes", async () => {
        const { tokens: managerTokens } = await seedManager();
        const { user: target } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${target.id}/classes`).set("Authorization", `Bearer ${managerTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("returns 403 when a regular user views another user's classes", async () => {
        const { tokens: studentTokens } = await seedStudent();
        const { user: target } = await seedSecondStudent();

        const res = await request(app).get(`/api/v1/user/${target.id}/classes`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 404 for a non-existent user", async () => {
        const { tokens } = await seedManager();

        const res = await request(app).get("/api/v1/user/99999/classes").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 without auth", async () => {
        const { user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/classes`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

describe("GET /api/v1/user/:id/scopes", () => {
    it("returns 200 when a user views their own scopes", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/scopes`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("role");
        expect(res.body.data).toHaveProperty("roles");
        expect(res.body.data).toHaveProperty("scopes");
        expect(res.body.data.roles).toHaveProperty("global");
        expect(res.body.data.roles).toHaveProperty("class");
        expect(res.body.data.scopes).toHaveProperty("global");
        expect(res.body.data.scopes).toHaveProperty("class");
    });

    it("returns 200 when a manager views another user's scopes", async () => {
        const { tokens: managerTokens } = await seedManager();
        const { user: target } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${target.id}/scopes`).set("Authorization", `Bearer ${managerTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("returns 403 when a regular user views another user's scopes", async () => {
        const { tokens: studentTokens } = await seedStudent();
        const { user: target } = await seedSecondStudent();

        const res = await request(app).get(`/api/v1/user/${target.id}/scopes`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 404 for a non-existent user", async () => {
        const { tokens } = await seedManager();

        const res = await request(app).get("/api/v1/user/99999/scopes").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 without auth", async () => {
        const { user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/scopes`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

describe("GET /api/v1/user/:id/transactions", () => {
    it("returns 200 when a user views their own transactions", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/transactions`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("transactions");
        expect(res.body.data).toHaveProperty("pagination");
    });

    it("returns 200 when a manager views another user's transactions", async () => {
        const { tokens: managerTokens } = await seedManager();
        const { user: target } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${target.id}/transactions`).set("Authorization", `Bearer ${managerTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("returns 403 when a regular user views another user's transactions", async () => {
        const { tokens: studentTokens } = await seedStudent();
        const { user: target } = await seedSecondStudent();

        const res = await request(app).get(`/api/v1/user/${target.id}/transactions`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 404 for a non-existent user", async () => {
        const { tokens } = await seedManager();

        const res = await request(app).get("/api/v1/user/99999/transactions").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 for an invalid limit", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/transactions?limit=999`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 for a negative offset", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/transactions?offset=-1`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 without auth", async () => {
        const { user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/transactions`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

describe("GET /api/v1/user/:id/pools", () => {
    it("returns 200 when a user views their own pools", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/pools`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("pools");
        expect(res.body.data).toHaveProperty("pagination");
    });

    it("returns 200 when a manager views another user's pools", async () => {
        const { tokens: managerTokens } = await seedManager();
        const { user: target } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${target.id}/pools`).set("Authorization", `Bearer ${managerTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("returns 403 when a regular user views another user's pools", async () => {
        const { tokens: studentTokens } = await seedStudent();
        const { user: target } = await seedSecondStudent();

        const res = await request(app).get(`/api/v1/user/${target.id}/pools`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 for an invalid limit", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/pools?limit=999`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 for a negative offset", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/pools?offset=-5`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 without auth", async () => {
        const { user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/pools`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

describe("GET /api/v1/user/:id/class", () => {
    it("returns 401 without auth", async () => {
        const { user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/class`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 404 when user is not in a class", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/class`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });
});

describe("POST /api/v1/user/:id/api/regenerate", () => {
    it("returns 401 without auth", async () => {
        const { user } = await seedStudent();

        const res = await request(app).post(`/api/v1/user/${user.id}/api/regenerate`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 and a new API key on success", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app).post(`/api/v1/user/${user.id}/api/regenerate`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.apiKey).toBe("new-api-key-123");
        expect(userService.regenerateAPIKey).toHaveBeenCalledWith(user.id);
    });
});
