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

const mockUsers = {};
jest.mock("@services/classroom-service", () => ({
    classStateStore: {
        getUser: jest.fn((email) => mockUsers[email] || null),
        getClassroom: jest.fn(() => null),
        getAllUsers: jest.fn(() => mockUsers),
        setUser: jest.fn((email, u) => {
            mockUsers[email] = u;
        }),
    },
    Classroom: jest.fn(),
}));

const { Student, createStudentFromUserData, getStudentsInClass, getIdFromEmail, getEmailFromId } = require("@services/student-service");
const { classStateStore } = require("@services/classroom-service");

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    jest.clearAllMocks();
    for (const k of Object.keys(mockUsers)) delete mockUsers[k];
});

afterAll(async () => {
    await mockDatabase.close();
});

let seedCounter = 0;
async function seedUser(overrides = {}) {
    seedCounter += 1;
    const defaults = {
        email: "student@test.com",
        password: "hashed",
        API: `api-${Date.now()}-${seedCounter}-${Math.random()}`,
        secret: `sec-${Date.now()}-${seedCounter}-${Math.random()}`,
        displayName: `Student_${Date.now()}_${seedCounter}`,
        digipogs: 0,
        pin: null,
        verified: 0,
    };
    const u = { ...defaults, ...overrides };
    const id = await mockDatabase.dbRun(
        "INSERT INTO users (email, password, API, secret, displayName, digipogs, pin, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [u.email, u.password, u.API, u.secret, u.displayName, u.digipogs, u.pin, u.verified]
    );
    // Assign global Student role (id=3) by default
    const roleId = u.globalRoleId || 3;
    await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, NULL)", [id, roleId]);
    return { id, ...u };
}

async function seedClassUser(classId, studentId, overrides = {}) {
    const defaults = { digiPogs: 0 };
    const cu = { ...defaults, ...overrides };
    await mockDatabase.dbRun("INSERT INTO classusers (classId, studentId, digiPogs) VALUES (?, ?, ?)", [classId, studentId, cu.digiPogs]);
    // Assign class role via user_roles if roleId provided
    if (cu.roleId) {
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [studentId, cu.roleId, classId]);
    }
}

describe("Student class", () => {
    it("sets all properties with defaults", () => {
        const s = new Student("a@b.com", 1, "key123");
        expect(s.email).toBe("a@b.com");
        expect(s.id).toBe(1);
        expect(s.API).toBe("key123");
        expect(s.ownedPolls).toEqual([]);
        expect(s.sharedPolls).toEqual([]);
        expect(s.tags).toEqual([]);
        expect(s.displayName).toBeUndefined();
        expect(s.isGuest).toBe(false);
        expect(s.activeClass).toBeNull();
        expect(s.role).toBeNull();
        expect(s).not.toHaveProperty("classRole");
        expect(s.roles.global).toEqual([]);
        expect(s.roles.class).toEqual([]);
        expect(s.help).toBe(false);
        expect(s.break).toBe(false);
        expect(s.digipogs).toBe(0);
        expect(s.pogMeter).toBe(0);
        expect(s.pollRes).toEqual({ buttonRes: "", textRes: "", time: null });
    });

    it("uses provided values when all arguments are given", () => {
        const s = new Student("x@y.com", 42, "apiKey", ["poll1"], ["poll2"], ["tag1", "tag2"], "Alice", true);
        expect(s.email).toBe("x@y.com");
        expect(s.id).toBe(42);
        expect(s.API).toBe("apiKey");
        expect(s.ownedPolls).toEqual(["poll1"]);
        expect(s.sharedPolls).toEqual(["poll2"]);
        expect(s.tags).toEqual(["tag1", "tag2"]);
        expect(s.displayName).toBe("Alice");
        expect(s.isGuest).toBe(true);
    });
});

describe("createStudentFromUserData()", () => {
    it("creates student with correct email, id, and API", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 7,
            API: "k",
            displayName: "U",
        });
        expect(s.email).toBe("u@test.com");
        expect(s.id).toBe(7);
        expect(s).toBeInstanceOf(Student);
    });

    it("sets activeClass from userData", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            activeClass: 99,
        });
        expect(s.activeClass).toBe(99);
    });

    it("sets roles.class from userData", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            roles: { class: [{ id: 1, name: "Teacher" }] },
        });
        expect(s.roles.class).toEqual([{ id: 1, name: "Teacher" }]);
    });

    it("sets role and roles.class from userData", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            role: "teacher",
            roles: { class: [{ id: 2, name: "helper" }] },
        });
        expect(s.role).toBe("teacher");
        expect(s.roles.class).toEqual([{ id: 2, name: "helper" }]);
    });

    it("normalizes tags from comma-separated string", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            tags: " math , science , ",
        });
        expect(s.tags).toEqual(["math", "science"]);
    });

    it("normalizes tags from array", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            tags: [" art ", "music"],
        });
        expect(s.tags).toEqual(["art", "music"]);
    });

    it("normalizes null tags to empty array", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            tags: null,
        });
        expect(s.tags).toEqual([]);
    });

    it("parses ownedPolls from JSON string", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            ownedPolls: JSON.stringify(["p1", "p2"]),
        });
        expect(s.ownedPolls).toEqual(["p1", "p2"]);
    });

    it("parses sharedPolls from JSON string", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            sharedPolls: JSON.stringify(["s1"]),
        });
        expect(s.sharedPolls).toEqual(["s1"]);
    });

    it("passes through ownedPolls when already an array", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            ownedPolls: ["a"],
        });
        expect(s.ownedPolls).toEqual(["a"]);
    });

    it("returns empty array for invalid JSON in ownedPolls", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            ownedPolls: "not-json",
        });
        expect(s.ownedPolls).toEqual([]);
    });

    it("sets isGuest from options.isGuest", () => {
        const s = createStudentFromUserData({ email: "u@test.com", id: 1 }, { isGuest: true });
        expect(s.isGuest).toBe(true);
    });

    it("falls back to userData.isGuest when options.isGuest is not set", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            isGuest: true,
        });
        expect(s.isGuest).toBe(true);
    });

    it("copies verified property when present", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            verified: 1,
        });
        expect(s.verified).toBe(1);
    });

    it("does not set verified when absent", () => {
        const s = createStudentFromUserData({ email: "u@test.com", id: 1 });
        expect(s).not.toHaveProperty("verified");
    });

    it("merges pollRes when provided", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            pollRes: { buttonRes: "A", textRes: "yes" },
        });
        expect(s.pollRes).toEqual({ buttonRes: "A", textRes: "yes", time: null });
    });

    it("sets help and break from userData", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            help: true,
            break: true,
        });
        expect(s.help).toBe(true);
        expect(s.break).toBe(true);
    });

    it("sets pogMeter from userData", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            pogMeter: 42,
        });
        expect(s.pogMeter).toBe(42);
    });

    it("sets digipogs from userData", () => {
        const s = createStudentFromUserData({
            email: "u@test.com",
            id: 1,
            digipogs: 7,
        });
        expect(s.digipogs).toBe(7);
    });
});

describe("getStudentsInClass()", () => {
    it("returns students keyed by email with roles.class", async () => {
        const user = await seedUser({ email: "stu@test.com" });
        await seedClassUser(10, user.id);

        // Seed a custom role and user_roles entry for the multi-role system
        const roleId = await mockDatabase.dbRun("INSERT INTO roles (name, scopes, color, isDefault) VALUES (?, ?, ?, 0)", [
            "helper",
            "[]",
            "#808080",
        ]);
        await mockDatabase.dbRun("INSERT INTO class_roles (roleId, classId) VALUES (?, ?)", [roleId, 10]);
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, roleId, 10]);

        const result = await getStudentsInClass(10);
        expect(result["stu@test.com"]).toBeDefined();

        const s = result["stu@test.com"];
        expect(s).toBeInstanceOf(Student);
        expect(s.email).toBe("stu@test.com");
        expect(s.id).toBe(user.id);
        expect(s.roles.class.map((r) => r.name)).toEqual(["helper"]);
        expect(s).not.toHaveProperty("classRole");
    });

    it("computes the primary role from full role assignments instead of plain role names", async () => {
        const user = await seedUser({ email: "multi@test.com" });
        await seedClassUser(11, user.id);

        const globalStudentRole = await mockDatabase.dbGet("SELECT scopes, color FROM roles WHERE name = 'Student' AND isDefault = 1");
        const classStudentRoleId = await mockDatabase.dbRun("INSERT INTO roles (name, scopes, color, isDefault) VALUES (?, ?, ?, 0)", [
            "Student",
            globalStudentRole.scopes,
            globalStudentRole.color,
        ]);
        await mockDatabase.dbRun("INSERT INTO class_roles (roleId, classId) VALUES (?, ?)", [classStudentRoleId, 11]);
        const helperRoleId = await mockDatabase.dbRun("INSERT INTO roles (name, scopes, color, isDefault) VALUES (?, ?, ?, 0)", [
            "Helper",
            JSON.stringify(["class.session.start"]),
            "#123456",
        ]);
        await mockDatabase.dbRun("INSERT INTO class_roles (roleId, classId) VALUES (?, ?)", [helperRoleId, 11]);

        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, classStudentRoleId, 11]);
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, helperRoleId, 11]);

        const result = await getStudentsInClass(11);
        const student = result["multi@test.com"];

        expect(student.roles.class.map((r) => r.name)).toEqual(expect.arrayContaining(["Student", "Helper"]));
        expect(student).not.toHaveProperty("classRole");
    });

    it("returns empty object when no students are in the class", async () => {
        const result = await getStudentsInClass(999);
        expect(result).toEqual({});
    });

    it("returns multiple students in the same class", async () => {
        const u1 = await seedUser({ email: "a@test.com" });
        const u2 = await seedUser({ email: "b@test.com" });
        await seedClassUser(20, u1.id);
        await seedClassUser(20, u2.id);

        const result = await getStudentsInClass(20);
        expect(Object.keys(result)).toHaveLength(2);
        expect(result["a@test.com"]).toBeDefined();
        expect(result["b@test.com"]).toBeDefined();
    });

    it("does not include students from a different class", async () => {
        const u1 = await seedUser({ email: "in@test.com" });
        const u2 = await seedUser({ email: "out@test.com" });
        await seedClassUser(30, u1.id);
        await seedClassUser(31, u2.id);

        const result = await getStudentsInClass(30);
        expect(Object.keys(result)).toHaveLength(1);
        expect(result["in@test.com"]).toBeDefined();
    });
});

describe("getIdFromEmail()", () => {
    it("returns id from classStateStore when user is loaded", () => {
        mockUsers["cached@test.com"] = { id: 55, email: "cached@test.com" };
        const result = getIdFromEmail("cached@test.com");
        expect(result).toBe(55);
        expect(classStateStore.getUser).toHaveBeenCalledWith("cached@test.com");
    });

    it("falls back to DB query when user not in memory", async () => {
        const user = await seedUser({ email: "db@test.com" });
        const id = await getIdFromEmail("db@test.com");
        expect(id).toBe(user.id);
    });

    it("returns undefined when classStateStore.getUser throws", () => {
        // The outer try/catch swallows the error and returns undefined
        classStateStore.getUser.mockImplementationOnce(() => {
            throw new Error("store failure");
        });
        const result = getIdFromEmail("nobody@test.com");
        expect(result).toBeUndefined();
    });
});

describe("getEmailFromId()", () => {
    it("returns email from classStateStore when user is loaded", async () => {
        mockUsers["mem@test.com"] = { id: 77, email: "mem@test.com" };
        const email = await getEmailFromId(77);
        expect(email).toBe("mem@test.com");
        expect(classStateStore.getAllUsers).toHaveBeenCalled();
    });

    it("matches in-memory users when a numeric id is provided as a string", async () => {
        mockUsers["mem@test.com"] = { id: 77, email: "mem@test.com" };
        const email = await getEmailFromId("77");
        expect(email).toBe("mem@test.com");
    });

    it("falls back to DB query when user not in memory", async () => {
        const user = await seedUser({ email: "dbfb@test.com" });
        const email = await getEmailFromId(user.id);
        expect(email).toBe("dbfb@test.com");
    });

    it("returns null when user does not exist anywhere", async () => {
        const email = await getEmailFromId(99999);
        expect(email).toBeNull();
    });
});
