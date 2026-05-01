/**
 * Unit tests for services/classroom-service.js
 *
 * Tests the Classroom class constructor and DB query helpers.
 * getClassIDFromCode is also tested; it falls back to a DB lookup when the
 * code is not cached.
 *
 * Uses an in-memory SQLite database so no real DB file is touched.
 */
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

const { Classroom, classStateStore, getClassroomFromDb, getClassIDFromCode } = require("@services/classroom-service");

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    // Clear the in-memory class-code cache between tests
    const { classCodeCacheStore } = require("@stores/class-code-cache-store");
    classCodeCacheStore.clear();
});

afterAll(async () => {
    await mockDatabase.close();
});

async function seedClassroom({ name = "Test Class", owner = 1, key = 1234 } = {}) {
    const id = await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?, ?)", [name, owner, key]);
    return { id, name, owner, key };
}

describe("Classroom constructor", () => {
    it("stores id, className, owner, and key", () => {
        const c = new Classroom({ id: 1, className: "Math", owner: 42, key: 9999 });
        expect(c.id).toBe(1);
        expect(c.className).toBe("Math");
        expect(c.owner).toBe(42);
        expect(c.key).toBe(9999);
    });

    it("initialises isActive to false", () => {
        const c = new Classroom({ id: 1, className: "Science", owner: 1, key: 1234 });
        expect(c.isActive).toBe(false);
    });

    it("initialises students as an empty object", () => {
        const c = new Classroom({ id: 1, className: "History", owner: 1, key: 1111 });
        expect(c.students).toEqual({});
    });

    it("initialises poll status to false", () => {
        const c = new Classroom({ id: 1, className: "Geo", owner: 1, key: 5555 });
        expect(c.poll.status).toBe(false);
    });

    it("initialises timer as inactive", () => {
        const c = new Classroom({ id: 1, className: "Chem", owner: 1, key: 6666 });
        expect(c.timer.active).toBe(false);
    });
});

describe("getClassroomFromDb()", () => {
    it("returns the classroom row for a valid id", async () => {
        const seeded = await seedClassroom({ name: "Biology", key: 7777 });
        const result = await getClassroomFromDb(seeded.id);
        expect(result).toBeDefined();
        expect(result.name).toBe("Biology");
        expect(result.key).toBe(7777);
    });

    it("returns undefined for a non-existent id", async () => {
        const result = await getClassroomFromDb(99999);
        expect(result).toBeUndefined();
    });

    it("throws an AppError when id is falsy (required param check)", () => {
        // getClassroomFromDb is synchronous before the DB call; requireInternalParam
        // throws immediately, not as a rejected promise.
        expect(() => getClassroomFromDb(null)).toThrow();
        expect(() => getClassroomFromDb(undefined)).toThrow();
    });
});

describe("getClassIDFromCode()", () => {
    it("returns the classroom id for a valid class code", async () => {
        const seeded = await seedClassroom({ key: 8888 });
        const result = await getClassIDFromCode(8888);
        expect(result).toBe(seeded.id);
    });

    it("returns null for a code that does not exist", async () => {
        const result = await getClassIDFromCode(9999);
        expect(result).toBeNull();
    });

    it("caches the result on subsequent calls", async () => {
        const seeded = await seedClassroom({ key: 1010 });
        const first = await getClassIDFromCode(1010);
        // Delete the DB row to prove the second call uses the cache
        await mockDatabase.dbRun("DELETE FROM classroom WHERE id = ?", [seeded.id]);
        const second = await getClassIDFromCode(1010);
        expect(second).toBe(first);
    });
});

describe("classStateStore", () => {
    afterEach(() => {
        classStateStore._state = { users: {}, classrooms: {} };
    });

    it("starts empty", () => {
        const state = classStateStore.getRawState();
        expect(Object.keys(state.users)).toHaveLength(0);
        expect(Object.keys(state.classrooms)).toHaveLength(0);
    });

    it("stores and retrieves a user by email", () => {
        const user = { email: "a@test.com", id: 1 };
        classStateStore.setUser("a@test.com", user);
        expect(classStateStore.getUser("a@test.com")).toEqual(user);
    });

    it("stores and retrieves a classroom by id", () => {
        const classroom = new Classroom({ id: 5, className: "Test", owner: 1, key: 1234 });
        classStateStore.setClassroom(5, classroom);
        expect(classStateStore.getClassroom(5)).toBe(classroom);
    });

    it("returns undefined for an unknown user", () => {
        expect(classStateStore.getUser("nobody@test.com")).toBeUndefined();
    });

    it("returns undefined for an unknown classroom", () => {
        expect(classStateStore.getClassroom(9999)).toBeUndefined();
    });
});
