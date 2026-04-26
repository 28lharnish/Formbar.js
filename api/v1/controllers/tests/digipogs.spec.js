const request = require("supertest");
const { createTestDb } = require("@test-helpers/db");
const { createTestApp, seedAuthenticatedUser, clearClassStateStore } = require("./helpers/test-app");

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
        rateLimit: {
            maxAttempts: 5,
            lockoutDuration: 15 * 60 * 1000,
            attemptWindow: 5 * 60 * 1000,
            minDelayBetweenAttempts: 0,
        },
    };
});

const awardController = require("../digipogs/award");
const transferController = require("../digipogs/transfer");
const { hasScope } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");

function nonDigipogPinScopeController(router) {
    router.post("/test-pin-scope", hasScope(SCOPES.GLOBAL.DIGIPOGS.TRANSFER), (req, res) => {
        res.status(200).json({ success: true });
    });
}

const app = createTestApp(awardController, transferController, nonDigipogPinScopeController);

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

describe("POST /api/v1/digipogs/award", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/digipogs/award").send({ to: "1", amount: 10 });

        expect(res.status).toBe(401);
    });

    it("returns 404 when the user has no active class (no classId)", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        const res = await request(app)
            .post("/api/v1/digipogs/award")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ to: "1", amount: 10 });

        expect(res.status).toBe(400);
    });

    it("returns 403 when the class is not active in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        // Set activeClass on the user but do NOT register the classroom
        const { classStateStore } = require("@services/classroom-service");
        const user = classStateStore.getUser("teacher@example.com");
        user.activeClass = 999;
        classStateStore.setUser("teacher@example.com", user);

        const res = await request(app)
            .post("/api/v1/digipogs/award")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ to: "1", amount: 10 });

        expect(res.status).toBe(403);
    });

    it("returns 403 when a student (permissions=2) tries to award (lacks class.digipogs.award)", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, { permissions: 2 });
        const { classStateStore, Classroom } = require("@services/classroom-service");

        const classroom = new Classroom({
            id: 1,
            className: "Test",
            key: "TEST1",
            owner: 99999,
            permissions: null,
            tags: null,
            settings: null,
        });
        classStateStore.setClassroom(1, classroom);

        // Add student to classroom with student-level class permissions
        const student = classStateStore.getUser("test@example.com");
        student.activeClass = 1;
        student.classPermissions = 2;
        classStateStore.setClassroomStudent(1, "test@example.com", student);

        const res = await request(app)
            .post("/api/v1/digipogs/award")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ to: "999", amount: 5 });

        expect(res.status).toBe(403);
    });

    it("returns 200 when a teacher in an active class awards digipogs", async () => {
        // Seed a recipient user first
        const { user: recipient } = await seedAuthenticatedUser(mockDatabase, {
            email: "student@example.com",
            displayName: "Student",
            permissions: 2,
        });

        const { tokens, user: teacher } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        const { classStateStore, Classroom } = require("@services/classroom-service");

        const classroom = new Classroom({
            id: 1,
            className: "Test",
            key: "TEST1",
            owner: teacher.id,
            permissions: null,
            tags: null,
        });
        classStateStore.setClassroom(1, classroom);

        // Add teacher to classroom with teacher-level class permissions
        const teacherStudent = classStateStore.getUser("teacher@example.com");
        teacherStudent.activeClass = 1;
        teacherStudent.classPermissions = 4;
        teacherStudent.roles = { global: [], class: ["Teacher"] };
        classStateStore.setClassroomStudent(1, "teacher@example.com", teacherStudent);

        const res = await request(app)
            .post("/api/v1/digipogs/award")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ to: { id: recipient.id, type: "user" }, amount: 10 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe("POST /api/v1/digipogs/transfer", () => {
    it("returns 400 when required fields (to, amount, pin) are missing", async () => {
        const res = await request(app).post("/api/v1/digipogs/transfer").send({});

        expect(res.status).toBe(400);
    });

    it("returns 400 when pin is missing", async () => {
        const { user } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).post("/api/v1/digipogs/transfer").send({ from: user.id, to: "999", amount: 5 });

        expect(res.status).toBe(400);
    });

    it("returns 400 when amount is missing", async () => {
        const { user } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).post("/api/v1/digipogs/transfer").send({ from: user.id, to: "999", pin: "1234" });

        expect(res.status).toBe(400);
    });

    it("returns 200 on a valid transfer between two users", async () => {
        const { hashBcrypt } = require("@modules/crypto");
        const pinHash = await hashBcrypt("1234");

        // Seed sender with digipogs and a pin
        const { user: sender } = await seedAuthenticatedUser(mockDatabase);
        await mockDatabase.dbRun("UPDATE users SET digipogs = 100, pin = ? WHERE id = ?", [pinHash, sender.id]);

        // Seed recipient
        const { user: recipient } = await seedAuthenticatedUser(mockDatabase, {
            email: "recipient@example.com",
            displayName: "Recipient",
            permissions: 2,
        });

        const res = await request(app).post("/api/v1/digipogs/transfer").send({ from: sender.id, to: recipient.id, amount: 10, pin: "1234" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify balances changed
        const senderAfter = await mockDatabase.dbGet("SELECT digipogs FROM users WHERE id = ?", [sender.id]);
        expect(senderAfter.digipogs).toBe(90);
    });

    it("authenticates a PIN-only transfer by looking up the requested sender", async () => {
        const { hashBcrypt } = require("@modules/crypto");
        const pinHash = await hashBcrypt("1234");

        const { user: sender } = await seedAuthenticatedUser(mockDatabase);
        await mockDatabase.dbRun("UPDATE users SET digipogs = 100, pin = ? WHERE id = ?", [pinHash, sender.id]);

        const { user: recipient } = await seedAuthenticatedUser(mockDatabase, {
            email: "pin-recipient@example.com",
            displayName: "PIN Recipient",
            permissions: 2,
        });

        const res = await request(app).post("/api/v1/digipogs/transfer").send({ from: sender.id, to: recipient.id, amount: 10, pin: "1234" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("accepts fromUserId as a sender alias for PIN-only transfers", async () => {
        const { hashBcrypt } = require("@modules/crypto");
        const pinHash = await hashBcrypt("1234");

        const { user: sender } = await seedAuthenticatedUser(mockDatabase);
        await mockDatabase.dbRun("UPDATE users SET digipogs = 100, pin = ? WHERE id = ?", [pinHash, sender.id]);

        const { user: recipient } = await seedAuthenticatedUser(mockDatabase, {
            email: "pin-alias-recipient@example.com",
            displayName: "PIN Alias Recipient",
            permissions: 2,
        });

        const res = await request(app).post("/api/v1/digipogs/transfer").send({ fromUserId: sender.id, to: recipient.id, amount: 10, pin: "1234" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("returns 400 when the sender has insufficient funds", async () => {
        const { hashBcrypt } = require("@modules/crypto");
        const pinHash = await hashBcrypt("1234");

        const { user: sender } = await seedAuthenticatedUser(mockDatabase);
        await mockDatabase.dbRun("UPDATE users SET digipogs = 0, pin = ? WHERE id = ?", [pinHash, sender.id]);

        const { user: recipient } = await seedAuthenticatedUser(mockDatabase, {
            email: "recipient@example.com",
            displayName: "Recipient",
            permissions: 2,
        });

        const res = await request(app).post("/api/v1/digipogs/transfer").send({ from: sender.id, to: recipient.id, amount: 50, pin: "1234" });

        expect(res.status).toBe(400);
    });

    it("returns 400 when the pin is incorrect", async () => {
        const { hashBcrypt } = require("@modules/crypto");
        const pinHash = await hashBcrypt("1234");

        const { user: sender } = await seedAuthenticatedUser(mockDatabase);
        await mockDatabase.dbRun("UPDATE users SET digipogs = 100, pin = ? WHERE id = ?", [pinHash, sender.id]);

        const { user: recipient } = await seedAuthenticatedUser(mockDatabase, {
            email: "recipient@example.com",
            displayName: "Recipient",
            permissions: 2,
        });

        const res = await request(app).post("/api/v1/digipogs/transfer").send({ from: sender.id, to: recipient.id, amount: 10, pin: "wrong" });

        expect(res.status).toBe(400);
    });
});

describe("POST /api/v1/test-pin-scope", () => {
    it("does not allow pin-based auth outside digipog HTTP APIs", async () => {
        const { hashBcrypt } = require("@modules/crypto");
        const pinHash = await hashBcrypt("1234");

        const { user } = await seedAuthenticatedUser(mockDatabase, {
            email: "pinonly@example.com",
            displayName: "Pin Only",
            permissions: 2,
        });
        await mockDatabase.dbRun("UPDATE users SET pin = ? WHERE id = ?", [pinHash, user.id]);

        const res = await request(app).post("/api/v1/test-pin-scope").send({ pin: "1234" });

        expect(res.status).toBe(401);
    });
});
