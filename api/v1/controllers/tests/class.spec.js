const request = require("supertest");
const { createTestDb } = require("@test-helpers/db");
const { createTestApp, seedAuthenticatedUser, seedClassMembership, clearClassStateStore } = require("./helpers/test-app");

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
        settings: { emailEnabled: false },
        publicKey,
        privateKey,
        frontendUrl: "http://localhost:3000",
    };
});

jest.mock("@modules/web-server", () => ({
    io: { to: () => ({ emit: jest.fn() }) },
}));

jest.mock("@services/socket-updates-service", () => ({
    advancedEmitToClass: jest.fn(),
    emitToUser: jest.fn(),
    managerUpdate: jest.fn().mockResolvedValue(),
    setClassOfApiSockets: jest.fn(),
    setClassOfUserSockets: jest.fn(),
    userUpdateSocket: jest.fn(),
    invalidateClassPollCache: jest.fn(),
}));

jest.mock("../../../../sockets/init", () => ({
    userSocketUpdates: new Map(),
}));

jest.mock("@stores/socket-state-store", () => ({
    socketStateStore: {
        getUserSocketsByEmail: jest.fn().mockReturnValue(null),
    },
}));

const createController = require("../class/create");
const classController = require("../class/class");
const joinController = require("../class/join");
const leaveController = require("../class/leave");
const startController = require("../class/start");
const endController = require("../class/end");
const studentsController = require("../class/students");
const activeController = require("../class/active");
const enrollController = require("../class/enroll");
const unenrollController = require("../class/unenroll");
const deleteController = require("../class/delete");
const tagsController = require("../class/tags");
const linksController = require("../class/links/links");
const addLinkController = require("../class/links/add");
const changeLinkController = require("../class/links/change");
const removeLinkController = require("../class/links/remove");
const bannedController = require("../class/banned");
const kickController = require("../class/kick");
const regenerateCodeController = require("../class/regenerate-code");

const { classStateStore, Classroom } = require("@services/classroom-service");
const { TEACHER_PERMISSIONS, MANAGER_PERMISSIONS, MOD_PERMISSIONS } = require("@modules/permissions");

const app = createTestApp(
    createController,
    tagsController,
    classController,
    joinController,
    leaveController,
    startController,
    endController,
    studentsController,
    activeController,
    enrollController,
    unenrollController,
    deleteController,
    linksController,
    addLinkController,
    changeLinkController,
    removeLinkController,
    bannedController,
    kickController,
    regenerateCodeController
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

async function createClassAsTeacher(tokens, name = "Test Class") {
    const res = await request(app).post("/api/v1/class/create").set("Authorization", `Bearer ${tokens.accessToken}`).send({ name });
    return res;
}

/**
 * Helper: creates a classroom row in the DB and loads it into classStateStore.
 * Returns the classroom id.
 */
async function seedClassroom(ownerId, { key = "TEST1", className = "Test Class" } = {}) {
    await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", [className, ownerId, key]);
    const row = await mockDatabase.dbGet("SELECT * FROM classroom WHERE key = ?", [key]);
    const classroom = new Classroom({
        id: row.id,
        className: row.name,
        key: row.key,
        owner: row.owner,
        permissions: null,
        tags: null,
    });
    classStateStore.setClassroom(row.id, classroom);
    return row.id;
}

/**
 * Helper: enrolls a user in a classroom (DB + in-memory).
 * classPermissions should be a numeric permission level.
 */
async function enrollUserInClass(user, classId, classPermissions = MOD_PERMISSIONS) {
    await seedClassMembership(mockDatabase, user.id, classId, classPermissions);

    const student = classStateStore.getUser(user.email);
    if (student) {
        const { getStudentRoleAssignments } = require("@services/role-service");
        const { buildRoleReferences } = require("@modules/role-reference");
        const assignedClassRoles = await getStudentRoleAssignments(classId, user.id);

        student.activeClass = classId;
        // Keep classPermissions for legacy compatibility assertions in this suite.
        student.classPermissions = classPermissions;
        student.roles = {
            global: student.roles?.global || [],
            class: buildRoleReferences(assignedClassRoles),
        };
        classStateStore.setClassroomStudent(classId, user.email, student);
    }
}

describe("POST /api/v1/class/create", () => {
    it("returns 200 and creates a class when called by a teacher", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        const res = await createClassAsTeacher(tokens, "Math 101");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("classId");
        expect(res.body.data).toHaveProperty("key");
        expect(res.body.data.className).toBe("Math 101");
    });

    it("returns 200 when called by a manager (permissions=5)", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "admin@example.com",
            displayName: "Admin1",
            permissions: 5,
        });

        const res = await createClassAsTeacher(tokens, "Admin Class");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("classId");
    });

    it("returns 403 when called by a student (permissions=2)", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "student@example.com",
            displayName: "Student1",
            permissions: 2,
        });

        const res = await createClassAsTeacher(tokens, "Denied Class");

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/create").send({ name: "No Auth Class" });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when name is missing", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher2@example.com",
            displayName: "Teacher2",
            permissions: 4,
        });

        const res = await request(app).post("/api/v1/class/create").set("Authorization", `Bearer ${tokens.accessToken}`).send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when name is too short", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher3@example.com",
            displayName: "Teacher3",
            permissions: 4,
        });

        const res = await request(app).post("/api/v1/class/create").set("Authorization", `Bearer ${tokens.accessToken}`).send({ name: "ab" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});

describe("GET /api/v1/class/:id", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 404 when class is not started (not in classStateStore)", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).get("/api/v1/class/9999").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when user is not in the class", async () => {
        const { classStateStore } = require("@services/classroom-service");
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        // Manually set up a class in classStateStore with no students
        classStateStore.setClassroom(42, {
            classId: 42,
            className: "Restricted Class",
            isActive: true,
            owner: 999,
            students: {},
            key: "ABCD",
            poll: null,
            tags: [],
            settings: {},
            timer: {},
        });

        const res = await request(app).get("/api/v1/class/42").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});

describe("POST /api/v1/class/:id/join", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/join");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 when a class member joins their class", async () => {
        // Create teacher + class
        const { tokens: teacherTokens, user: teacher } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        const createRes = await createClassAsTeacher(teacherTokens, "Join Test");
        const classId = createRes.body.data.classId;

        // Create a student
        const { tokens: studentTokens, user: student } = await seedAuthenticatedUser(mockDatabase, {
            email: "student@example.com",
            displayName: "Student1",
            permissions: 2,
        });

        // Enroll student in class via DB
        await seedClassMembership(mockDatabase, student.id, classId, 2);

        const res = await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("returns 404 when class does not exist", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).post("/api/v1/class/9999/join").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when user is not enrolled in the class", async () => {
        const { tokens: teacherTokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        const createRes = await createClassAsTeacher(teacherTokens, "No Enroll");
        const classId = createRes.body.data.classId;

        // Create a non-enrolled student
        const { tokens: studentTokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "outsider@example.com",
            displayName: "Outsider",
            permissions: 2,
        });

        const res = await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});

describe("POST /api/v1/class/:id/leave", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/leave");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 404 when user is not in the specified class", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).post("/api/v1/class/9999/leave").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });
});

describe("POST /api/v1/class/:id/start", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/start");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when class is not active in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        const res = await request(app).post("/api/v1/class/9999/start").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});

describe("POST /api/v1/class/:id/end", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/end");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when class is not active in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        const res = await request(app).post("/api/v1/class/9999/end").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});

describe("GET /api/v1/class/:id/students", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/students");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when class is not active in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        const res = await request(app).get("/api/v1/class/9999/students").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});

describe("GET /api/v1/class/:id/active", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/active");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when user is not a member of the class", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).get("/api/v1/class/9999/active").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 with isActive false when class owner checks inactive class", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        // Create a class so the teacher is the owner in the DB
        // initializeClassroom sets isActive = false by default
        const createRes = await createClassAsTeacher(tokens, "Active Check");
        const classId = createRes.body.data.classId;

        const res = await request(app).get(`/api/v1/class/${classId}/active`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.isActive).toBe(false);
    });

    it("returns 200 with isActive true when class is started", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher2@example.com",
            displayName: "Teacher2",
            permissions: 4,
        });

        const createRes = await createClassAsTeacher(tokens, "Active True");
        const classId = createRes.body.data.classId;

        // Mark classroom as active directly
        const { classStateStore } = require("@services/classroom-service");
        const classroom = classStateStore.getClassroom(classId);
        if (classroom) {
            classroom.isActive = true;
        }

        const res = await request(app).get(`/api/v1/class/${classId}/active`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.isActive).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Tests merged from room.spec.js (enroll, unenroll, delete, tags, links, banned)
// ---------------------------------------------------------------------------

describe("POST /api/v1/class/enroll/:code", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/enroll/TESTCODE");
        expect(res.status).toBe(401);
    });

    it("returns 404 when the class code does not exist", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);
        const res = await request(app).post("/api/v1/class/enroll/BADCODE").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(404);
    });
});

describe("POST /api/v1/class/:id/unenroll", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/unenroll");
        expect(res.status).toBe(401);
    });
});

describe("DELETE /api/v1/class/:id", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).delete("/api/v1/class/1");
        expect(res.status).toBe(401);
    });

    it("returns 403 when user is not the owner and lacks admin scope", async () => {
        const { tokens: ownerTokens, user: owner } = await seedAuthenticatedUser(mockDatabase, {
            email: "owner@example.com",
            displayName: "Owner",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(owner.id);

        const { tokens: otherTokens, user: otherUser } = await seedAuthenticatedUser(mockDatabase, {
            email: "other@example.com",
            displayName: "Other",
            permissions: TEACHER_PERMISSIONS,
        });

        const res = await request(app).delete(`/api/v1/class/${classId}`).set("Authorization", `Bearer ${otherTokens.accessToken}`);
        expect(res.status).toBe(403);
    });

    it("returns 200 when the class owner deletes the class", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "owner@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);

        const res = await request(app).delete(`/api/v1/class/${classId}`).set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const deleted = await mockDatabase.dbGet("SELECT * FROM classroom WHERE id = ?", [classId]);
        expect(deleted).toBeUndefined();
    });

    it("returns 200 when a manager deletes any class", async () => {
        const { user: owner } = await seedAuthenticatedUser(mockDatabase, {
            email: "owner@example.com",
            displayName: "Owner",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(owner.id);

        const { tokens: managerTokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "manager@example.com",
            displayName: "Manager",
            permissions: MANAGER_PERMISSIONS,
        });

        const res = await request(app).delete(`/api/v1/class/${classId}`).set("Authorization", `Bearer ${managerTokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("returns 404 when the class does not exist", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "owner@example.com",
            permissions: MANAGER_PERMISSIONS,
        });

        const res = await request(app).delete("/api/v1/class/99999").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(404);
    });
});

describe("GET /api/v1/class/:id/tags", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/tags");
        expect(res.status).toBe(401);
    });

    it("returns 404 when class is not loaded", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);
        const res = await request(app).get("/api/v1/class/9999/tags").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(404);
    });

    it("returns 200 with tags for a loaded class", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        classStateStore.updateUser(user.email, { activeClass: classId });

        const res = await request(app).get(`/api/v1/class/${classId}/tags`).set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data.tags)).toBe(true);
    });
});

describe("PUT /api/v1/class/:id/tags", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app)
            .put("/api/v1/class/1/tags")
            .send({ tags: ["math"] });
        expect(res.status).toBe(401);
    });

    it("returns 403 when user lacks class.tags.manage scope", async () => {
        const { user: owner } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Tag Owner",
            permissions: TEACHER_PERMISSIONS,
        });
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "student@example.com",
            displayName: "Tag Student",
            permissions: 2,
        });

        const classId = await seedClassroom(owner.id);
        await enrollUserInClass(user, classId, 2);
        classStateStore.updateUser(user.email, { activeClass: classId });

        const res = await request(app)
            .put(`/api/v1/class/${classId}/tags`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ tags: ["math"] });
        expect(res.status).toBe(403);
    });
});

describe("GET /api/v1/class/:id/links", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/links");
        expect(res.status).toBe(401);
    });

    it("returns 200 with links when user has class.links.read scope", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        await mockDatabase.dbRun("INSERT INTO links (classId, name, url) VALUES (?, ?, ?)", [classId, "Course Website", "https://example.com"]);

        const res = await request(app).get(`/api/v1/class/${classId}/links`).set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data.links)).toBe(true);
        expect(res.body.data.links).toHaveLength(1);
        expect(res.body.data.links[0]).toMatchObject({ name: "Course Website", url: "https://example.com" });
    });
});

describe("POST /api/v1/class/:id/links/add", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/links/add").send({ name: "Link", url: "https://example.com" });
        expect(res.status).toBe(401);
    });

    it("returns 200 when a teacher adds a link", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        const res = await request(app)
            .post(`/api/v1/class/${classId}/links/add`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ name: "Docs", url: "https://docs.example.com" });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const link = await mockDatabase.dbGet("SELECT * FROM links WHERE classId = ?", [classId]);
        expect(link).toBeDefined();
        expect(link.name).toBe("Docs");
    });

    it("returns 400 when name or url is missing", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        const res = await request(app)
            .post(`/api/v1/class/${classId}/links/add`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ name: "Missing URL" });
        expect(res.status).toBe(400);
    });
});

describe("PUT /api/v1/class/:id/links", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).put("/api/v1/class/1/links").send({ name: "Link", url: "https://example.com" });
        expect(res.status).toBe(401);
    });

    it("returns 200 when a teacher updates a link", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        await mockDatabase.dbRun("INSERT INTO links (classId, name, url) VALUES (?, ?, ?)", [classId, "Old Link", "https://old.example.com"]);

        const res = await request(app)
            .put(`/api/v1/class/${classId}/links`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ oldName: "Old Link", name: "New Link", url: "https://new.example.com" });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe("DELETE /api/v1/class/:id/links", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).delete("/api/v1/class/1/links").send({ name: "Link" });
        expect(res.status).toBe(401);
    });

    it("returns 200 when a teacher removes a link", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        await mockDatabase.dbRun("INSERT INTO links (classId, name, url) VALUES (?, ?, ?)", [classId, "ToRemove", "https://remove.example.com"]);

        const res = await request(app)
            .delete(`/api/v1/class/${classId}/links`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ name: "ToRemove" });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const link = await mockDatabase.dbGet("SELECT * FROM links WHERE classId = ? AND name = ?", [classId, "ToRemove"]);
        expect(link).toBeUndefined();
    });

    it("returns 400 when name is missing", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        const res = await request(app).delete(`/api/v1/class/${classId}/links`).set("Authorization", `Bearer ${tokens.accessToken}`).send({});
        expect(res.status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// Deprecated endpoints (use /class/ paths)
// ---------------------------------------------------------------------------

describe("POST /api/v1/class/:id/tags (deprecated)", () => {
    it("returns 200 with deprecation headers when a teacher sets tags", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);
        classStateStore.updateUser(user.email, { activeClass: classId });

        const res = await request(app)
            .post(`/api/v1/class/${classId}/tags`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ tags: ["science"] });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.headers["x-deprecated"]).toBeDefined();
        expect(res.headers["warning"]).toMatch(/299/);
    });
});

describe("POST /api/v1/class/:id/links/change (deprecated)", () => {
    it("returns 200 with deprecation headers when a teacher changes a link", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        await mockDatabase.dbRun("INSERT INTO links (classId, name, url) VALUES (?, ?, ?)", [classId, "Old", "https://old.example.com"]);

        const res = await request(app)
            .post(`/api/v1/class/${classId}/links/change`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ oldName: "Old", name: "New", url: "https://new.example.com" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.headers["x-deprecated"]).toBeDefined();
        expect(res.headers["warning"]).toMatch(/299/);
    });
});

describe("POST /api/v1/class/:id/links/remove (deprecated)", () => {
    it("returns 200 with deprecation headers when a teacher removes a link", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        await mockDatabase.dbRun("INSERT INTO links (classId, name, url) VALUES (?, ?, ?)", [classId, "ToRemove", "https://remove.example.com"]);

        const res = await request(app)
            .post(`/api/v1/class/${classId}/links/remove`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ name: "ToRemove" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.headers["x-deprecated"]).toBeDefined();
        expect(res.headers["warning"]).toMatch(/299/);
    });
});

describe("GET /api/v1/class/:id/banned", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/banned");
        expect(res.status).toBe(401);
    });

    it("returns 403 when class not in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });

        const res = await request(app).get("/api/v1/class/9999/banned").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
    });

    it("returns 200 with empty array when no banned users", async () => {
        const { tokens: teacherTokens, user: teacher } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: TEACHER_PERMISSIONS,
        });

        const createRes = await request(app)
            .post("/api/v1/class/create")
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ name: "Banned Test Class" });
        const classId = createRes.body.data.classId;

        await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        const res = await request(app).get(`/api/v1/class/${classId}/banned`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data).toHaveLength(0);
    });
});

describe("POST /api/v1/class/:id/students/:userId/kick", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/students/2/kick");
        expect(res.status).toBe(401);
    });

    it("returns 200 and removes the student from the class roster", async () => {
        const { tokens: teacherTokens, user: teacher } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher-kick@example.com",
            displayName: "Teacher Kick",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(teacher.id, { key: "KICK1", className: "Kick Test" });
        await enrollUserInClass(teacher, classId, TEACHER_PERMISSIONS);

        const { user: student } = await seedAuthenticatedUser(mockDatabase, {
            email: "student-kick@example.com",
            displayName: "Student Kick",
            permissions: 2,
        });
        await enrollUserInClass(student, classId, 2);

        const res = await request(app)
            .post(`/api/v1/class/${classId}/students/${student.id}/kick`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const classUser = await mockDatabase.dbGet("SELECT 1 FROM classusers WHERE classId = ? AND studentId = ?", [classId, student.id]);
        expect(classUser).toBeUndefined();
    });
});

describe("POST /api/v1/class/:id/students/kick-all", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/students/kick-all");
        expect(res.status).toBe(401);
    });

    it("supports the compatibility route with userId in the path", async () => {
        const { tokens: teacherTokens, user: teacher } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher-kickall-compat@example.com",
            displayName: "KickCompat",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(teacher.id, { key: "KALC1", className: "Kick All Compat Test" });
        await enrollUserInClass(teacher, classId, TEACHER_PERMISSIONS);

        const res = await request(app)
            .post(`/api/v1/class/${classId}/students/${teacher.id}/kick-all`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("kicks only users without teacher-related scopes", async () => {
        const { tokens: teacherTokens, user: teacher } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher-kickall@example.com",
            displayName: "Teacher Kick All",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(teacher.id, { key: "KALL1", className: "Kick All Test" });
        await enrollUserInClass(teacher, classId, TEACHER_PERMISSIONS);

        const { user: teacherScopedStudent } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher-scope@example.com",
            displayName: "Teacher Scoped",
            permissions: 2,
        });
        await enrollUserInClass(teacherScopedStudent, classId, TEACHER_PERMISSIONS);

        const { user: regularStudent } = await seedAuthenticatedUser(mockDatabase, {
            email: "regular-scope@example.com",
            displayName: "Regular Student",
            permissions: 2,
        });
        await enrollUserInClass(regularStudent, classId, 2);

        const res = await request(app).post(`/api/v1/class/${classId}/students/kick-all`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const teacherScopedMembership = await mockDatabase.dbGet("SELECT 1 FROM classusers WHERE classId = ? AND studentId = ?", [
            classId,
            teacherScopedStudent.id,
        ]);
        const regularMembership = await mockDatabase.dbGet("SELECT 1 FROM classusers WHERE classId = ? AND studentId = ?", [
            classId,
            regularStudent.id,
        ]);

        expect(teacherScopedMembership).toBeDefined();
        expect(regularMembership).toBeUndefined();
    });
});

describe("POST /api/v1/class/:id/code/regenerate", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/code/regenerate");
        expect(res.status).toBe(401);
    });

    it("returns 200 and regenerates the class code", async () => {
        const { tokens: teacherTokens, user: teacher } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher-regen@example.com",
            displayName: "Teacher Regen",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(teacher.id, { key: "RGN01", className: "Regenerate Test" });
        await enrollUserInClass(teacher, classId, TEACHER_PERMISSIONS);

        const before = await mockDatabase.dbGet("SELECT key FROM classroom WHERE id = ?", [classId]);

        const res = await request(app).post(`/api/v1/class/${classId}/code/regenerate`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(typeof res.body.data.key).toBe("string");
        expect(res.body.data.key.length).toBe(4);

        const after = await mockDatabase.dbGet("SELECT key FROM classroom WHERE id = ?", [classId]);
        expect(after.key).not.toBe(before.key);
        expect(after.key).toBe(res.body.data.key);
    });
});
