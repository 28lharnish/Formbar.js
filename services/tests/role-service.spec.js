const { createTestDb } = require("@test-helpers/db");

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

jest.mock("@modules/config", () => ({
    settings: { emailEnabled: false },
    frontendUrl: "http://localhost:3000",
    rateLimit: {
        maxAttempts: 5,
        lockoutDuration: 900000,
        minDelayBetweenAttempts: 1000,
        attemptWindow: 300000,
    },
}));

const mockClassrooms = {};
const mockUsers = {};
jest.mock("@services/classroom-service", () => ({
    classStateStore: {
        getClassroom: jest.fn((id) => mockClassrooms[id] || null),
        getAllClassrooms: jest.fn(() => mockClassrooms),
        setClassroom: jest.fn((id, c) => {
            mockClassrooms[id] = c;
        }),
        getUser: jest.fn((email) => mockUsers[email] || null),
        getAllUsers: jest.fn(() => mockUsers),
        setUser: jest.fn((email, u) => {
            mockUsers[email] = u;
        }),
        setClassroomStudent: jest.fn((classId, email, student) => {
            if (mockClassrooms[classId]) {
                mockClassrooms[classId].students[email] = student;
            }
        }),
    },
    Classroom: jest.fn(),
}));

const {
    addStudentRole,
    removeStudentRole,
    getStudentRoles,
    getStudentRoleAssignments,
    getUserRoles,
    getActingUser,
    getClassRoles,
    createClassRole,
    updateClassRole,
    deleteClassRole,
    addDefaultClassRoles,
} = require("@services/role-service");
const { getUserScopes } = require("@modules/scope-resolver");
const ValidationError = require("@errors/validation-error");
const NotFoundError = require("@errors/not-found-error");
const ForbiddenError = require("@errors/forbidden-error");

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    jest.clearAllMocks();
    for (const k of Object.keys(mockClassrooms)) delete mockClassrooms[k];
    for (const k of Object.keys(mockUsers)) delete mockUsers[k];
});

afterAll(async () => {
    await mockDatabase.close();
});

let seedCounter = 0;
async function seedUser(overrides = {}) {
    seedCounter += 1;
    const defaults = {
        email: `user${seedCounter}@test.com`,
        password: "hashed",
        API: `api-${seedCounter}-${Date.now()}`,
        secret: `sec-${seedCounter}-${Date.now()}`,
        displayName: `User_${seedCounter}`,
        digipogs: 0,
        pin: null,
        verified: 0,
    };
    const u = { ...defaults, ...overrides };
    const id = await mockDatabase.dbRun(
        "INSERT INTO users (email, password, API, secret, displayName, digipogs, pin, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [u.email, u.password, u.API, u.secret, u.displayName, u.digipogs, u.pin, u.verified]
    );
    const roleId = u.globalRoleId || 3;
    await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, NULL)", [id, roleId]);
    return { id, ...u };
}

async function seedClass(ownerId, { seedDefaultRoles = true } = {}) {
    const classId = await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", ["TestClass", ownerId, 123456]);
    if (seedDefaultRoles) {
        await addDefaultClassRoles(classId);
    }
    return classId;
}

async function seedClassUser(classId, studentId, overrides = {}) {
    const defaults = { digiPogs: 0 };
    const cu = { ...defaults, ...overrides };
    await mockDatabase.dbRun("INSERT INTO classusers (classId, studentId, digiPogs) VALUES (?, ?, ?)", [classId, studentId, cu.digiPogs]);
}

function setupMockClassroom(classId, ownerId, students = {}) {
    mockClassrooms[classId] = {
        classId,
        owner: ownerId,
        students,
        customRoles: {},
        roleOverrides: {},
    };
}

async function getRoleIdByName(roleName, classId = null) {
    const row =
        classId == null
            ? await mockDatabase.dbGet("SELECT id FROM roles WHERE name = ? AND isDefault = 1", [roleName])
            : await mockDatabase.dbGet(
                  `SELECT r.id
                   FROM roles r
                   JOIN class_roles cr ON cr.roleId = r.id
                   WHERE r.name = ? AND cr.classId = ?`,
                  [roleName, classId]
              );

    return row ? row.id : null;
}

describe("getActingUser()", () => {
    it("returns null when classroom is null", () => {
        expect(getActingUser(null, { email: "a@b.com", id: 1 })).toBeNull();
    });

    it("returns the student when found in students map", () => {
        const student = { email: "a@b.com", roles: { global: [], class: ["Student"] } };
        const classroom = { students: { "a@b.com": student }, owner: 99 };
        expect(getActingUser(classroom, { email: "a@b.com", id: 1 })).toBe(student);
    });

    it("returns synthetic owner context for class owner not in students map", () => {
        const classroom = { students: {}, owner: 5 };
        const result = getActingUser(classroom, { email: "owner@test.com", id: 5 });
        expect(result).toEqual({
            id: 5,
            email: "owner@test.com",
            roles: { global: [], class: [] },
            isClassOwner: true,
        });
    });

    it("returns synthetic owner context when owner matched by email", () => {
        const classroom = { students: {}, owner: "owner@test.com" };
        const result = getActingUser(classroom, { email: "owner@test.com", id: 5 });
        expect(result).toEqual({
            id: 5,
            email: "owner@test.com",
            roles: { global: [], class: [] },
            isClassOwner: true,
        });
    });

    it("returns null for non-member non-owner", () => {
        const classroom = { students: {}, owner: 99 };
        expect(getActingUser(classroom, { email: "stranger@test.com", id: 1 })).toBeNull();
    });

    it("prefers student match over owner fallback", () => {
        const student = { email: "owner@test.com", roles: { global: [], class: ["Student"] } };
        const classroom = { students: { "owner@test.com": student }, owner: 5 };
        expect(getActingUser(classroom, { email: "owner@test.com", id: 5 })).toBe(student);
    });
});

describe("getStudentRoles()", () => {
    it("returns empty array when no roles assigned", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        const roles = await getStudentRoles(classId, user.id);
        expect(roles).toEqual([]);
    });

    it("returns assigned role names", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        const modRole = await mockDatabase.dbGet("SELECT id FROM roles WHERE name = 'Mod' AND isDefault = 1");
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, modRole.id, classId]);

        const roles = await getStudentRoles(classId, user.id);
        expect(roles).toEqual(["Mod"]);
    });

    it("returns multiple roles", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        const modRole = await mockDatabase.dbGet("SELECT id FROM roles WHERE name = 'Mod' AND isDefault = 1");
        const studentRole = await mockDatabase.dbGet("SELECT id FROM roles WHERE name = 'Student' AND isDefault = 1");
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, modRole.id, classId]);
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, studentRole.id, classId]);

        const roles = await getStudentRoles(classId, user.id);
        expect(roles).toContain("Mod");
        expect(roles).toContain("Student");
        expect(roles).toHaveLength(2);
    });
});

describe("getStudentRoleAssignments()", () => {
    it("does not treat global roles as explicit class role assignments", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        const assignments = await getStudentRoleAssignments(classId, user.id);
        expect(assignments).toEqual([]);
    });

    it("returns explicit class roles in class order with null orderIndex values last", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        const teacherRoleId = await getRoleIdByName("Teacher");
        const modRoleId = await getRoleIdByName("Mod");
        const bannedRoleId = await getRoleIdByName("Banned");

        await addStudentRole(classId, user.id, modRoleId);
        await addStudentRole(classId, user.id, teacherRoleId);
        await addStudentRole(classId, user.id, bannedRoleId);

        const assignments = await getStudentRoleAssignments(classId, user.id);
        expect(assignments.map((role) => role.name)).toEqual(["Teacher", "Mod", "Banned"]);
    });
});

describe("getUserRoles()", () => {
    it("returns scope-bearing role objects so custom class roles resolve correctly", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        const helperRoleId = await mockDatabase.dbRun("INSERT INTO roles (name, scopes, color, isDefault) VALUES (?, ?, ?, 0)", [
            "Helper",
            '["class.poll.create"]',
            "#123456",
        ]);
        await mockDatabase.dbRun("INSERT INTO class_roles (roleId, classId) VALUES (?, ?)", [helperRoleId, classId]);
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, helperRoleId, classId]);

        setupMockClassroom(classId, user.id, {
            [user.email]: {
                id: user.id,
                email: user.email,
                roles: { global: [], class: [] },
            },
        });

        const roles = await getUserRoles(user.id);

        expect(roles.global).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: expect.any(Number),
                    name: "Student",
                    scopes: expect.any(String),
                }),
            ])
        );
        expect(roles.class).toEqual([
            expect.objectContaining({
                id: helperRoleId,
                name: "Helper",
                scopes: '["class.poll.create"]',
            }),
        ]);

        const scopes = getUserScopes({ id: user.id, roles });
        expect(scopes.global).toEqual(expect.arrayContaining(["global.pools.manage", "global.digipogs.transfer"]));
        expect(scopes.class).toEqual(expect.arrayContaining(["class.poll.create"]));
    });

    it("does not treat global roles as explicit class roles", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        setupMockClassroom(classId, user.id, {
            [user.email]: {
                id: user.id,
                email: user.email,
                roles: { global: [], class: [] },
            },
        });

        await getClassRoles(classId);
        const roles = await getUserRoles(user.id);

        expect(roles.global).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: "Student",
                }),
            ])
        );
        expect(roles.class).toEqual([]);
    });
});

describe("createClassRole()", () => {
    it("creates a custom role with the provided color", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        setupMockClassroom(classId, user.id, {});

        const actingUser = { roles: { global: [], class: ["Manager"] } };
        const classroom = mockClassrooms[classId];

        const role = await createClassRole({
            classId,
            name: "Helper",
            scopes: ["class.poll.create"],
            actingClassUser: actingUser,
            classroom,
            color: "#123456",
        });

        expect(role.name).toBe("Helper");
        expect(role.scopes).toEqual(["class.poll.create"]);
        expect(role.color).toBe("#123456");

        const row = await mockDatabase.dbGet("SELECT color FROM roles WHERE id = ?", [role.id]);
        expect(row.color).toBe("#123456");
    });

    it("defaults custom role color to #808080 when omitted", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        setupMockClassroom(classId, user.id, {});

        const actingUser = { roles: { global: [], class: ["Manager"] } };
        const classroom = mockClassrooms[classId];

        const role = await createClassRole({
            classId,
            name: "DefaultColorRole",
            scopes: ["class.poll.create"],
            actingClassUser: actingUser,
            classroom,
        });

        expect(role.color).toBe("#808080");
    });
});

describe("addStudentRole()", () => {
    it("adds a built-in role to a student", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);
        setupMockClassroom(classId, user.id, {
            [user.email]: { roles: { global: [], class: [] } },
        });
        const modRoleId = await getRoleIdByName("Mod");

        await addStudentRole(classId, user.id, modRoleId);

        const roles = await getStudentRoles(classId, user.id);
        expect(roles).toContain("Mod");
    });

    it("updates in-memory roles.class", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);
        setupMockClassroom(classId, user.id, {
            [user.email]: { roles: { global: [], class: [] } },
        });
        const modRoleId = await getRoleIdByName("Mod");

        await addStudentRole(classId, user.id, modRoleId);

        const student = mockClassrooms[classId].students[user.email];
        expect(student.roles.class.map((role) => role.name)).toContain("Mod");
    });

    it("throws ValidationError for Guest role", async () => {
        const guestRoleId = await getRoleIdByName("Guest");
        await expect(addStudentRole(1, 1, guestRoleId)).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError for non-existent role", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        await expect(addStudentRole(classId, user.id, 999999)).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError when user is not a class member", async () => {
        const owner = await seedUser();
        const nonMember = await seedUser();
        const classId = await seedClass(owner.id);
        const modRoleId = await getRoleIdByName("Mod");

        await expect(addStudentRole(classId, nonMember.id, modRoleId)).rejects.toThrow(NotFoundError);
    });

    it("throws ValidationError for duplicate role assignment", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);
        setupMockClassroom(classId, user.id, {
            [user.email]: { roles: { global: [], class: [] } },
        });
        const modRoleId = await getRoleIdByName("Mod");

        await addStudentRole(classId, user.id, modRoleId);
        await expect(addStudentRole(classId, user.id, modRoleId)).rejects.toThrow(ValidationError);
    });

    it("adds a custom role to a student", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);
        const helperRoleId = await mockDatabase.dbRun("INSERT INTO roles (name, scopes, color, isDefault) VALUES (?, ?, ?, 0)", [
            "Helper",
            '["class.poll.create"]',
            "#808080",
        ]);
        await mockDatabase.dbRun("INSERT INTO class_roles (roleId, classId) VALUES (?, ?)", [helperRoleId, classId]);
        setupMockClassroom(classId, user.id, {
            [user.email]: { roles: { global: [], class: [] } },
        });
        mockClassrooms[classId].customRoles = { [helperRoleId]: ["class.poll.create"] };

        await addStudentRole(classId, user.id, helperRoleId);

        const roles = await getStudentRoles(classId, user.id);
        expect(roles).toContain("Helper");
    });

    it("adds a role to an active global guest without classusers membership", async () => {
        const owner = await seedUser();
        const classId = await seedClass(owner.id);
        const guestId = "guest-123";
        const guestEmail = "guest@test.local";

        mockUsers[guestEmail] = {
            id: guestId,
            email: guestEmail,
            isGuest: true,
            roles: { global: [], class: [] },
        };

        setupMockClassroom(classId, owner.id, {
            [guestEmail]: {
                id: guestId,
                email: guestEmail,
                isGuest: true,
                roles: { global: [], class: [] },
            },
        });

        const modRoleId = await getRoleIdByName("Mod", classId);
        await addStudentRole(classId, guestId, modRoleId);

        const roles = await getStudentRoles(classId, guestId);
        expect(roles).toContain("Mod");
        expect(mockClassrooms[classId].students[guestEmail].roles.class.map((role) => role.name)).toContain("Mod");

        const persistedAssignments = await mockDatabase.dbGetAll("SELECT roleId FROM user_roles WHERE userId = ? AND classId = ?", [
            guestId,
            classId,
        ]);
        expect(persistedAssignments).toEqual([]);
    });

    it("throws ForbiddenError for privilege escalation", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);
        setupMockClassroom(classId, user.id);

        const actingUser = { roles: { global: [], class: ["Student"] } };
        const classroom = mockClassrooms[classId];
        const teacherRoleId = await getRoleIdByName("Teacher");

        await expect(addStudentRole(classId, user.id, teacherRoleId, actingUser, classroom)).rejects.toThrow(ForbiddenError);
    });
});

describe("removeStudentRole()", () => {
    it("removes an assigned role", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        await getClassRoles(classId);
        const modRole = await mockDatabase.dbGet(
            `SELECT r.id
             FROM roles r
             JOIN class_roles cr ON cr.roleId = r.id
             WHERE r.name = 'Mod' AND cr.classId = ?`,
            [classId]
        );
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, modRole.id, classId]);

        setupMockClassroom(classId, user.id, {
            [user.email]: {
                roles: { global: [], class: [{ id: modRole.id, name: "Mod" }] },
            },
        });

        await removeStudentRole(classId, user.id, modRole.id);

        const roles = await getStudentRoles(classId, user.id);
        expect(roles).toEqual([]);
    });

    it("updates in-memory roles.class after removal", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        await getClassRoles(classId);
        const modRole = await mockDatabase.dbGet(
            `SELECT r.id
             FROM roles r
             JOIN class_roles cr ON cr.roleId = r.id
             WHERE r.name = 'Mod' AND cr.classId = ?`,
            [classId]
        );
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, modRole.id, classId]);

        setupMockClassroom(classId, user.id, {
            [user.email]: {
                roles: { global: [], class: [{ id: modRole.id, name: "Mod" }] },
            },
        });

        await removeStudentRole(classId, user.id, modRole.id);

        const student = mockClassrooms[classId].students[user.email];
        expect(student.roles.class.map((role) => role.name)).not.toContain("Mod");
    });

    it("does not auto-assign Student when the last explicit class role is removed", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        await getClassRoles(classId);
        const modRole = await mockDatabase.dbGet(
            `SELECT r.id
             FROM roles r
             JOIN class_roles cr ON cr.roleId = r.id
             WHERE r.name = 'Mod' AND cr.classId = ?`,
            [classId]
        );
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, modRole.id, classId]);

        await removeStudentRole(classId, user.id, modRole.id);

        const remainingRoleRows = await mockDatabase.dbGetAll("SELECT roleId FROM user_roles WHERE userId = ? AND classId = ?", [user.id, classId]);
        expect(remainingRoleRows).toEqual([]);
    });

    it("throws ValidationError for Guest role", async () => {
        const guestRoleId = await getRoleIdByName("Guest");
        await expect(removeStudentRole(1, 1, guestRoleId)).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError when role is not assigned", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);
        const modRoleId = await getRoleIdByName("Mod");

        await expect(removeStudentRole(classId, user.id, modRoleId)).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError for non-existent role", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        await expect(removeStudentRole(classId, user.id, 999999)).rejects.toThrow(ValidationError);
    });

    it("removes an in-memory-only role from an active guest", async () => {
        const owner = await seedUser();
        const classId = await seedClass(owner.id);
        const guestId = "guest-456";
        const guestEmail = "guest-remove@test.local";

        mockUsers[guestEmail] = {
            id: guestId,
            email: guestEmail,
            isGuest: true,
            roles: { global: [], class: [] },
        };

        setupMockClassroom(classId, owner.id, {
            [guestEmail]: {
                id: guestId,
                email: guestEmail,
                isGuest: true,
                roles: { global: [], class: [] },
            },
        });

        const modRoleId = await getRoleIdByName("Mod", classId);
        await addStudentRole(classId, guestId, modRoleId);
        await removeStudentRole(classId, guestId, modRoleId);

        expect(await getStudentRoles(classId, guestId)).toEqual([]);
        expect(mockClassrooms[classId].students[guestEmail].roles.class).toEqual([]);

        const persistedAssignments = await mockDatabase.dbGetAll("SELECT roleId FROM user_roles WHERE userId = ? AND classId = ?", [
            guestId,
            classId,
        ]);
        expect(persistedAssignments).toEqual([]);
    });
});

describe("getClassRoles()", () => {
    it("returns built-in roles in class order with Banned last", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);

        const roles = await getClassRoles(classId);
        expect(roles.map((role) => role.name).slice(0, 6)).toEqual(["Manager", "Teacher", "Mod", "Student", "Guest", "Banned"]);
    });

    it("returns default roles", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);

        const roles = await getClassRoles(classId);
        const names = roles.map((role) => role.name);
        expect(names).toContain("Guest");
        expect(names).toContain("Student");
        expect(names).toContain("Mod");
        expect(names).toContain("Teacher");
        expect(names).toContain("Manager");
        expect(names).toContain("Banned");
    });

    it("does not lazily recreate default roles for classes without class_roles", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id, { seedDefaultRoles: false });

        const roles = await getClassRoles(classId);
        const classRoleRows = await mockDatabase.dbGetAll("SELECT roleId FROM class_roles WHERE classId = ?", [classId]);

        expect(roles).toEqual([]);
        expect(classRoleRows).toEqual([]);
    });

    it("includes custom roles for the class", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        const helperRoleId = await mockDatabase.dbRun("INSERT INTO roles (name, scopes, color, isDefault) VALUES (?, ?, ?, 0)", [
            "Helper",
            '["class.poll.create"]',
            "#808080",
        ]);
        await mockDatabase.dbRun("INSERT INTO class_roles (roleId, classId) VALUES (?, ?)", [helperRoleId, classId]);

        const roles = await getClassRoles(classId);
        const custom = roles.find((role) => role.name === "Helper");
        expect(custom).toBeDefined();
        expect(custom.scopes).toEqual(["class.poll.create"]);
    });

    it("returns role ids for class roles", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);

        const roles = await getClassRoles(classId);
        expect(roles.length).toBeGreaterThanOrEqual(6);
        roles.forEach((role) => expect(typeof role.id).toBe("number"));
    });

    it("derives built-in role ordering from role names instead of fixed ids", async () => {
        await mockDatabase.dbRun("UPDATE roles SET id = id + 100 WHERE isDefault = 1");
        const studentRole = await mockDatabase.dbGet("SELECT id FROM roles WHERE name = 'Student' AND isDefault = 1");
        const user = await seedUser({ globalRoleId: studentRole.id });
        const classId = await seedClass(user.id);

        const roles = await getClassRoles(classId);
        expect(roles.map((role) => role.name).slice(0, 6)).toEqual(["Manager", "Teacher", "Mod", "Student", "Guest", "Banned"]);
    });

    it("allows updating default role scopes in a class", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);

        const roles = await getClassRoles(classId);
        const teacherRole = roles.find((role) => role.name === "Teacher");
        expect(teacherRole).toBeDefined();

        await updateClassRole({
            roleId: teacherRole.id,
            classId,
            updates: { scopes: ["class.poll.read"] },
            actingClassUser: { roles: { global: [], class: ["Manager"] } },
            classroom: { customRoles: {} },
        });

        const updatedRoles = await getClassRoles(classId);
        const updatedTeacher = updatedRoles.find((role) => role.name === "Teacher");
        expect(updatedTeacher.scopes).toEqual(["class.poll.read"]);
    });

    it("deduplicates legacy and explicit assignments when customizing a default role", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        const roles = await getClassRoles(classId);
        const teacherRole = roles.find((role) => role.name === "Teacher");

        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, NULL)", [user.id, teacherRole.id]);
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, teacherRole.id, classId]);

        const updatedRole = await updateClassRole({
            roleId: teacherRole.id,
            classId,
            updates: { scopes: ["class.poll.read"] },
            actingClassUser: { roles: { global: [], class: ["Manager"] } },
            classroom: { customRoles: {} },
        });

        const assignedRoles = await mockDatabase.dbGetAll(
            "SELECT roleId, classId FROM user_roles WHERE userId = ? AND (classId = ? OR classId IS NULL) ORDER BY classId, roleId",
            [user.id, classId]
        );

        expect(assignedRoles.filter((row) => Number(row.roleId) === Number(updatedRole.id) && Number(row.classId) === Number(classId))).toHaveLength(
            1
        );
        expect(assignedRoles.some((row) => Number(row.roleId) === Number(teacherRole.id))).toBe(false);
    });

    it("does not recreate a deleted default role on later reads", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);

        const roles = await getClassRoles(classId);
        const teacherRole = roles.find((role) => role.name === "Teacher");

        await deleteClassRole(teacherRole.id, classId);

        const remainingRoles = await getClassRoles(classId);
        const classRoleRows = await mockDatabase.dbGetAll("SELECT roleId FROM class_roles WHERE classId = ?", [classId]);

        expect(remainingRoles.map((role) => role.name)).not.toContain("Teacher");
        expect(classRoleRows).toHaveLength(5);
    });

    it("returns custom role colors", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        const helperRoleId = await mockDatabase.dbRun("INSERT INTO roles (name, scopes, color, isDefault) VALUES (?, ?, ?, 0)", [
            "Helper",
            '["class.poll.create"]',
            "#123456",
        ]);
        await mockDatabase.dbRun("INSERT INTO class_roles (roleId, classId) VALUES (?, ?)", [helperRoleId, classId]);

        const roles = await getClassRoles(classId);
        const custom = roles.find((role) => role.name === "Helper");
        expect(custom.color).toBe("#123456");
    });
});
