const { createTestDb } = require("@test-helpers/db");
const { setGlobalPermissionLevel } = require("@test-helpers/role-seeding");

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

jest.mock("@modules/mail", () => ({ sendMail: jest.fn() }));

jest.mock("@services/socket-updates-service", () => ({
    managerUpdate: jest.fn(),
    userUpdateSocket: jest.fn(),
}));

jest.mock("@stores/socket-state-store", () => ({
    socketStateStore: {
        removeUserSocket: jest.fn(() => ({ emptyAfterRemoval: true })),
        removeLastActivity: jest.fn(),
        getUserSocketsByEmail: jest.fn(() => null),
    },
}));

jest.mock("@stores/api-key-cache-store", () => ({
    apiKeyCacheStore: {
        invalidateByEmail: jest.fn(),
        clear: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
    },
}));

jest.mock("@modules/socket-error-handler", () => ({
    handleSocketError: jest.fn(),
}));

jest.mock("@services/classroom-service", () => {
    const classrooms = {};
    const users = {};
    return {
        classStateStore: {
            getClassroom: jest.fn((id) => classrooms[id] || null),
            setClassroom: jest.fn((id, c) => {
                classrooms[id] = c;
            }),
            getAllClassrooms: jest.fn(() => classrooms),
            getUser: jest.fn((email) => users[email] || null),
            setUser: jest.fn((email, u) => {
                users[email] = u;
            }),
            removeUser: jest.fn((email) => {
                delete users[email];
            }),
            updateUser: jest.fn((email, updates) => {
                if (users[email]) Object.assign(users[email], updates);
            }),
            _classrooms: classrooms,
            _users: users,
        },
    };
});

jest.mock("@services/class-service", () => ({
    endClass: jest.fn(),
    deleteClassrooms: jest.fn(),
}));

jest.mock("@services/poll-service", () => ({
    deleteCustomPolls: jest.fn(),
}));

jest.mock("@services/student-service", () => ({
    getEmailFromId: jest.fn(async (userId) => {
        const { dbGet } = require("@modules/database");
        const row = await dbGet("SELECT email FROM users WHERE id = ?", [userId]);
        return row ? row.email : null;
    }),
}));

const fs = require("fs");
const realReadFileSync = fs.readFileSync;
const bcrypt = require("bcrypt");
const { hashBcrypt, compareBcrypt, sha256 } = require("@modules/crypto");
const { sendMail } = require("@modules/mail");
const { apiKeyCacheStore } = require("@stores/api-key-cache-store");
const { classStateStore } = require("@services/classroom-service");
const { socketStateStore } = require("@stores/socket-state-store");
const { managerUpdate, userUpdateSocket } = require("@services/socket-updates-service");
const { deleteCustomPolls } = require("@services/poll-service");
const { deleteClassrooms } = require("@services/class-service");
const AppError = require("@errors/app-error");
const NotFoundError = require("@errors/not-found-error");
const AuthError = require("@errors/auth-error");

const {
    getUserDataFromDb,
    requestPasswordReset,
    requestVerificationEmail,
    verifyEmailFromCode,
    resetPassword,
    updatePassword,
    regenerateAPIKey,
    requestPinReset,
    resetPin,
    updatePin,
    verifyPin,
    getUser,
    getUserOwnedClasses,
    getUserClass,
    logout,
    deleteUser,
} = require("@services/user-service");

function mockTemplateFileReads() {
    fs.readFileSync.mockImplementation((filePath, ...args) => {
        const normalizedPath = String(filePath).replace(/\\/g, "/");
        if (normalizedPath.endsWith("email-templates/password-reset.hbs")) return "{{resetUrl}}";
        if (normalizedPath.endsWith("email-templates/pin-reset.hbs")) return "{{resetUrl}}";
        if (normalizedPath.endsWith("email-templates/verify-email.hbs")) return "{{verifyUrl}}";
        return realReadFileSync.call(fs, filePath, ...args);
    });
}

function getTokenFromLastEmail() {
    const body = sendMail.mock.calls.at(-1)[2];
    return body.match(/code(?:=|&#x3D;)([0-9a-f]+)/)?.[1] || "";
}

beforeAll(async () => {
    mockDatabase = await createTestDb();
    // Spy AFTER createTestDb so test-schema.sql is read with the real fs
    jest.spyOn(fs, "readFileSync");
    mockTemplateFileReads();
});

afterEach(async () => {
    await mockDatabase.reset();
    jest.clearAllMocks();
    mockTemplateFileReads();
    for (const k of Object.keys(classStateStore._classrooms)) delete classStateStore._classrooms[k];
    for (const k of Object.keys(classStateStore._users)) delete classStateStore._users[k];
});

afterAll(async () => {
    fs.readFileSync.mockRestore();
    await mockDatabase.close();
});

let uniqueCounter = 0;
async function seedUser(overrides = {}) {
    uniqueCounter++;
    const defaults = {
        email: `test${uniqueCounter}@test.com`,
        password: "hashed",
        permissions: 2,
        API: `apikey${uniqueCounter}`,
        secret: `secret${uniqueCounter}`,
        displayName: `TestUser${uniqueCounter}`,
        digipogs: 100,
        pin: null,
        verified: 0,
    };
    const u = { ...defaults, ...overrides };
    const id = await mockDatabase.dbRun(
        "INSERT INTO users (email, password, API, secret, displayName, digipogs, pin, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [u.email, u.password, u.API, u.secret, u.displayName, u.digipogs, u.pin, u.verified]
    );
    await setGlobalPermissionLevel(mockDatabase, id, u.permissions);
    return { id, ...u };
}

describe("getUserDataFromDb()", () => {
    it("returns the user row for a valid id", async () => {
        const seeded = await seedUser({ email: "lookup@test.com" });
        const result = await getUserDataFromDb(seeded.id);
        expect(result.email).toBe("lookup@test.com");
        expect(result.id).toBe(seeded.id);
    });

    it("keeps manager accounts at permission level 5", async () => {
        const seeded = await seedUser({ email: "manager@test.com", permissions: 5 });
        const result = await getUserDataFromDb(seeded.id);
        expect(result.role).toBe("Manager");
        expect(result.permissions).toBe(5);
    });

    it("returns undefined for a non-existent id", async () => {
        const result = await getUserDataFromDb(99999);
        expect(result).toBeUndefined();
    });
});

describe("requestPasswordReset()", () => {
    it("stores a purpose-bound token and calls sendMail", async () => {
        const seeded = await seedUser({ email: "reset@test.com", secret: "oldsecret" });
        await requestPasswordReset("reset@test.com");

        const row = await mockDatabase.dbGet("SELECT secret FROM users WHERE id = ?", [seeded.id]);
        expect(row.secret).toBe("oldsecret");
        const tokenRow = await mockDatabase.dbGet("SELECT purpose, used_at FROM user_tokens WHERE user_id = ?", [seeded.id]);
        expect(tokenRow).toMatchObject({ purpose: "password_reset", used_at: null });
        expect(sendMail).toHaveBeenCalledWith("reset@test.com", "Formbar Password Change", expect.any(String));
    });

    it("sends email with frontendUrl-based reset link", async () => {
        await seedUser({ email: "link@test.com" });
        await requestPasswordReset("link@test.com");
        const emailBody = sendMail.mock.calls[0][2];
        expect(emailBody).toContain("http://localhost:3000/user/me/password?code");
    });
});

describe("requestVerificationEmail()", () => {
    it("throws AppError when userId is missing", async () => {
        await expect(requestVerificationEmail(null, "http://api")).rejects.toThrow(AppError);
    });

    it("throws NotFoundError for non-existent user", async () => {
        await expect(requestVerificationEmail(99999, "http://api")).rejects.toThrow(NotFoundError);
    });

    it("returns alreadyVerified=true for verified users", async () => {
        const seeded = await seedUser({ verified: 1, secret: "versecret" });
        const result = await requestVerificationEmail(seeded.id, "http://api");
        expect(result).toEqual({ alreadyVerified: true });
        expect(sendMail).not.toHaveBeenCalled();
    });

    it("sends verification email for unverified users", async () => {
        const seeded = await seedUser({ verified: 0, email: "unver@test.com", secret: "vold" });
        const result = await requestVerificationEmail(seeded.id, "http://api");
        expect(result).toEqual({ alreadyVerified: false });
        expect(sendMail).toHaveBeenCalledWith("unver@test.com", "Formbar Email Verification", expect.any(String));

        const row = await mockDatabase.dbGet("SELECT secret FROM users WHERE id = ?", [seeded.id]);
        expect(row.secret).toBe("vold");
        const tokenRow = await mockDatabase.dbGet("SELECT purpose FROM user_tokens WHERE user_id = ?", [seeded.id]);
        expect(tokenRow.purpose).toBe("email_verify");
    });
});

describe("verifyEmailFromCode()", () => {
    it("throws AppError when code is missing", async () => {
        await expect(verifyEmailFromCode(null)).rejects.toThrow(AppError);
    });

    it("throws NotFoundError for invalid code", async () => {
        await expect(verifyEmailFromCode("nonexistent-code")).rejects.toMatchObject({
            message: "Verification token is invalid or has expired.",
            event: "user.verify.email.failed",
            reason: "invalid_code",
            statusCode: 404,
        });
    });

    it("marks the user as verified and returns userId", async () => {
        const seeded = await seedUser({ verified: 0 });
        await requestVerificationEmail(seeded.id, "http://api");
        const token = getTokenFromLastEmail();
        const result = await verifyEmailFromCode(token);
        expect(result.userId).toBe(seeded.id);
        expect(result.alreadyVerified).toBe(false);

        const row = await mockDatabase.dbGet("SELECT verified FROM users WHERE id = ?", [seeded.id]);
        expect(row.verified).toBe(1);
    });

    it("returns alreadyVerified=true without updating if already verified", async () => {
        const seeded = await seedUser({ verified: 1 });
        await mockDatabase.dbRun("INSERT INTO user_tokens (user_id, purpose, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [
            seeded.id,
            "email_verify",
            sha256("vercode2"),
            1,
            Math.floor(Date.now() / 1000) + 60,
        ]);
        const result = await verifyEmailFromCode("vercode2");
        expect(result.alreadyVerified).toBe(true);
    });

    it("updates classStateStore when user is in memory", async () => {
        const seeded = await seedUser({ verified: 0 });
        await requestVerificationEmail(seeded.id, "http://api");
        const token = getTokenFromLastEmail();
        classStateStore._users[seeded.email] = { email: seeded.email, verified: 0 };
        await verifyEmailFromCode(token);
        expect(classStateStore.updateUser).toHaveBeenCalledWith(seeded.email, { verified: 1 });
    });
});

describe("resetPassword()", () => {
    it("throws AppError when password is missing", async () => {
        await expect(resetPassword(null, "token")).rejects.toThrow(AppError);
    });

    it("throws AppError when token is missing", async () => {
        await expect(resetPassword("newpass", null)).rejects.toThrow(AppError);
    });

    it("throws NotFoundError for invalid token", async () => {
        await expect(resetPassword("newpass", "badtoken")).rejects.toMatchObject({
            message: "Password reset token is invalid or has expired.",
            event: "user.password.reset.failed",
            reason: "invalid_token",
            statusCode: 404,
        });
    });

    it("hashes and stores the new password", async () => {
        const seeded = await seedUser({ email: "reset-password@test.com" });
        await requestPasswordReset(seeded.email);
        const token = getTokenFromLastEmail();
        const result = await resetPassword("NewPassword1!", token);
        expect(result).toBe(true);

        const row = await mockDatabase.dbGet("SELECT password FROM users WHERE id = ?", [seeded.id]);
        expect(row.password).not.toBe("NewPassword1!");
        expect(row.password.startsWith("$2b$")).toBe(true);
        const matches = await compareBcrypt("NewPassword1!", row.password);
        expect(matches).toBe(true);
    });

    it("rejects passwords that do not meet validation requirements", async () => {
        const seeded = await seedUser({ email: "bad-password@test.com" });
        await requestPasswordReset(seeded.email);
        await expect(resetPassword("bad", getTokenFromLastEmail())).rejects.toThrow(/Password must be 5-20 characters/i);
    });
});

describe("updatePassword()", () => {
    it("sets a first password when the account does not have one yet", async () => {
        const seeded = await seedUser({ password: null });
        const result = await updatePassword(seeded.id, null, "NewPassword1!");
        expect(result).toBe(true);

        const row = await mockDatabase.dbGet("SELECT password FROM users WHERE id = ?", [seeded.id]);
        const matches = await compareBcrypt("NewPassword1!", row.password);
        expect(matches).toBe(true);
    });

    it("updates an existing password when the old password matches", async () => {
        const hashedPassword = await hashBcrypt("OldPassword1!");
        const seeded = await seedUser({ password: hashedPassword });

        await updatePassword(seeded.id, "OldPassword1!", "NewPassword1!");

        const row = await mockDatabase.dbGet("SELECT password FROM users WHERE id = ?", [seeded.id]);
        const matches = await compareBcrypt("NewPassword1!", row.password);
        expect(matches).toBe(true);
    });

    it("requires the current password when one already exists", async () => {
        const hashedPassword = await hashBcrypt("OldPassword1!");
        const seeded = await seedUser({ password: hashedPassword });

        await expect(updatePassword(seeded.id, null, "NewPassword1!")).rejects.toThrow(AppError);
    });

    it("throws AuthError when the current password is incorrect", async () => {
        const hashedPassword = await hashBcrypt("OldPassword1!");
        const seeded = await seedUser({ password: hashedPassword });

        await expect(updatePassword(seeded.id, "WrongPassword1!", "NewPassword1!")).rejects.toThrow(AuthError);
    });
});

describe("regenerateAPIKey()", () => {
    it("throws AppError when userId is missing", async () => {
        await expect(regenerateAPIKey(null)).rejects.toThrow(AppError);
    });

    it("throws NotFoundError for non-existent user", async () => {
        await expect(regenerateAPIKey(99999)).rejects.toThrow(NotFoundError);
    });

    it("returns a new plaintext API key and stores a sha256 hash", async () => {
        const seeded = await seedUser({ email: "apiuser@test.com", API: "oldapi" });
        const newKey = await regenerateAPIKey(seeded.id);

        expect(typeof newKey).toBe("string");
        expect(newKey.length).toBe(64);

        const row = await mockDatabase.dbGet("SELECT API FROM users WHERE id = ?", [seeded.id]);
        expect(row.API).not.toBe("oldapi");
        expect(row.API).not.toBe(newKey);
        expect(row.API).toBe(sha256(newKey));
    });

    it("invalidates the API key cache", async () => {
        const seeded = await seedUser({ email: "apicache@test.com" });
        await regenerateAPIKey(seeded.id);
        expect(apiKeyCacheStore.invalidateByEmail).toHaveBeenCalledWith("apicache@test.com");
    });
});

describe("requestPinReset()", () => {
    it("throws AppError when userId is missing", async () => {
        await expect(requestPinReset(null)).rejects.toThrow(AppError);
    });

    it("throws NotFoundError for non-existent user", async () => {
        await expect(requestPinReset(99999)).rejects.toThrow(NotFoundError);
    });

    it("stores a purpose-bound token and sends an email", async () => {
        const seeded = await seedUser({ email: "pinreset@test.com", secret: "oldsec" });
        await requestPinReset(seeded.id);

        const row = await mockDatabase.dbGet("SELECT secret FROM users WHERE id = ?", [seeded.id]);
        expect(row.secret).toBe("oldsec");
        const tokenRow = await mockDatabase.dbGet("SELECT purpose, used_at FROM user_tokens WHERE user_id = ?", [seeded.id]);
        expect(tokenRow).toMatchObject({ purpose: "pin_reset", used_at: null });
        expect(sendMail).toHaveBeenCalledWith("pinreset@test.com", "Formbar PIN Reset", expect.any(String));
    });
});

describe("resetPin()", () => {
    it("throws AppError when newPin is missing", async () => {
        await expect(resetPin(null, "token")).rejects.toThrow(AppError);
    });

    it("throws AppError when token is missing", async () => {
        await expect(resetPin("1234", null)).rejects.toThrow(AppError);
    });

    it("throws NotFoundError for invalid token", async () => {
        await expect(resetPin("1234", "badtoken")).rejects.toMatchObject({
            message: "PIN reset token is invalid or has expired.",
            event: "user.pin.reset.failed",
            reason: "invalid_token",
            statusCode: 404,
        });
    });

    it("hashes and stores the new pin", async () => {
        const seeded = await seedUser({ email: "pin-token@test.com" });
        await requestPinReset(seeded.id);
        await resetPin("5678", getTokenFromLastEmail());

        const row = await mockDatabase.dbGet("SELECT pin FROM users WHERE id = ?", [seeded.id]);
        expect(row.pin).not.toBe("5678");
        const matches = await compareBcrypt("5678", row.pin);
        expect(matches).toBe(true);
    });
});

describe("updatePin()", () => {
    it("throws AppError when userId is missing", async () => {
        await expect(updatePin(null, "old", "new")).rejects.toThrow(AppError);
    });

    it("throws AppError when newPin is missing", async () => {
        const seeded = await seedUser();
        await expect(updatePin(seeded.id, "old", null)).rejects.toThrow(AppError);
    });

    it("throws NotFoundError for non-existent user", async () => {
        await expect(updatePin(99999, null, "1234")).rejects.toThrow(NotFoundError);
    });

    it("sets pin when user has no existing pin (oldPin not required)", async () => {
        const seeded = await seedUser({ pin: null });
        await updatePin(seeded.id, null, "1234");

        const row = await mockDatabase.dbGet("SELECT pin FROM users WHERE id = ?", [seeded.id]);
        const matches = await compareBcrypt("1234", row.pin);
        expect(matches).toBe(true);
    });

    it("updates pin when old pin matches", async () => {
        const hashedOld = await hashBcrypt("1111");
        const seeded = await seedUser({ pin: hashedOld });
        await updatePin(seeded.id, "1111", "2222");

        const row = await mockDatabase.dbGet("SELECT pin FROM users WHERE id = ?", [seeded.id]);
        const matches = await compareBcrypt("2222", row.pin);
        expect(matches).toBe(true);
    });

    it("throws AuthError when old pin is incorrect", async () => {
        const hashedOld = await hashBcrypt("1111");
        const seeded = await seedUser({ pin: hashedOld });
        await expect(updatePin(seeded.id, "9999", "2222")).rejects.toThrow(AuthError);
    });

    it("throws AppError when old pin is missing but user has a pin", async () => {
        const hashedOld = await hashBcrypt("1111");
        const seeded = await seedUser({ pin: hashedOld });
        await expect(updatePin(seeded.id, null, "2222")).rejects.toThrow(AppError);
    });
});

describe("verifyPin()", () => {
    it("throws AppError when userId is missing", async () => {
        await expect(verifyPin(null, "1234")).rejects.toThrow(AppError);
    });

    it("throws AppError when pin is missing", async () => {
        const seeded = await seedUser();
        await expect(verifyPin(seeded.id, null)).rejects.toThrow(AppError);
    });

    it("throws NotFoundError for non-existent user", async () => {
        await expect(verifyPin(99999, "1234")).rejects.toThrow(NotFoundError);
    });

    it("throws AppError when no pin is set", async () => {
        const seeded = await seedUser({ pin: null });
        await expect(verifyPin(seeded.id, "1234")).rejects.toThrow(/No PIN is set/);
    });

    it("returns true when pin matches", async () => {
        const hashedPin = await hashBcrypt("5555");
        const seeded = await seedUser({ pin: hashedPin });
        const result = await verifyPin(seeded.id, "5555");
        expect(result).toBe(true);
    });

    it("throws AuthError when pin is incorrect", async () => {
        const hashedPin = await hashBcrypt("5555");
        const seeded = await seedUser({ pin: hashedPin });
        await expect(verifyPin(seeded.id, "0000")).rejects.toThrow(AuthError);
    });
});

describe("getUserClass()", () => {
    it("returns null when user is not in any classroom", () => {
        const result = getUserClass("nobody@test.com");
        expect(result).toBeNull();
    });

    it("returns the classroom id when user is a student", () => {
        classStateStore._classrooms[42] = {
            id: 42,
            students: { "student@test.com": { email: "student@test.com" } },
        };
        const result = getUserClass("student@test.com");
        expect(result).toBe(42);
    });

    it("returns null when email does not match any student", () => {
        classStateStore._classrooms[42] = {
            id: 42,
            students: { "other@test.com": {} },
        };
        const result = getUserClass("nobody@test.com");
        expect(result).toBeNull();
    });
});

describe("getUser()", () => {
    it("returns user data for email-based lookup (no class)", async () => {
        const seeded = await seedUser({ email: "getuser@test.com", permissions: 2 });
        const result = await getUser({ email: "getuser@test.com" });
        expect(result.email).toBe("getuser@test.com");
        expect(result.id).toBe(seeded.id);
        expect(result.loggedIn).toBe(false);
        expect(result.classId).toBeNull();
    });

    it("returns error object for non-existent email", async () => {
        const result = await getUser({ email: "noone@test.com" });
        expect(result).toHaveProperty("error");
    });

    it("includes class permissions when user is in a classroom", async () => {
        const seeded = await seedUser({ email: "inclazz@test.com", permissions: 2 });
        await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", ["TestClass", seeded.id, 1234]);
        const classRow = await mockDatabase.dbGet("SELECT id FROM classroom WHERE name = 'TestClass'");

        classStateStore._classrooms[classRow.id] = {
            id: classRow.id,
            students: { "inclazz@test.com": { email: "inclazz@test.com", help: true, break: false, pogMeter: 50 } },
        };

        const result = await getUser({ email: "inclazz@test.com" });
        // Owner gets classPermissions = 5
        expect(result.classPermissions).toBe(5);
        expect(result.loggedIn).toBe(true);
        expect(result.help).toBe(true);
        expect(result.pogMeter).toBe(50);
    });
});

describe("getUserOwnedClasses()", () => {
    it("returns classrooms owned by the user", async () => {
        const seeded = await seedUser({ email: "owner@test.com" });
        await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", ["Class1", seeded.id, 1111]);
        await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", ["Class2", seeded.id, 2222]);

        const result = await getUserOwnedClasses("owner@test.com");
        expect(result).toHaveLength(2);
        expect(result.map((c) => c.name).sort()).toEqual(["Class1", "Class2"]);
    });

    it("returns empty array when user owns no classes", async () => {
        const seeded = await seedUser({ email: "noclass@test.com" });
        const otherUser = await seedUser({ email: "other@test.com" });
        await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", ["OtherClass", otherUser.id, 3333]);

        const result = await getUserOwnedClasses("noclass@test.com");
        expect(result).toHaveLength(0);
    });
});

describe("logout()", () => {
    function createMockSocket(overrides = {}) {
        const defaults = {
            id: "socket-id-1",
            request: {
                session: {
                    email: "logout@test.com",
                    userId: 1,
                    classId: null,
                    destroy: jest.fn((cb) => cb(null)),
                },
            },
            leave: jest.fn(),
            emit: jest.fn(),
        };
        return { ...defaults, ...overrides };
    }

    it("calls session.destroy and emits reload", () => {
        const socket = createMockSocket();
        logout(socket);
        expect(socket.request.session.destroy).toHaveBeenCalled();
        expect(socket.emit).toHaveBeenCalledWith("reload");
    });

    it("removes user socket and last activity", () => {
        const socket = createMockSocket();
        logout(socket);
        expect(socketStateStore.removeUserSocket).toHaveBeenCalledWith("logout@test.com", "socket-id-1");
        expect(socketStateStore.removeLastActivity).toHaveBeenCalledWith("logout@test.com", "socket-id-1");
    });

    it("leaves the class room when classId is set", () => {
        const socket = createMockSocket({
            request: {
                session: {
                    email: "logout@test.com",
                    userId: 1,
                    classId: 10,
                    destroy: jest.fn((cb) => cb(null)),
                },
            },
        });
        logout(socket);
        expect(socket.leave).toHaveBeenCalledWith("class-10");
    });

    it("resets user state in classStateStore on last session", () => {
        classStateStore._users["logout@test.com"] = {
            email: "logout@test.com",
            permissions: 2,
            activeClass: 10,
            break: true,
            help: true,
            classPermissions: 3,
        };
        const socket = createMockSocket();
        logout(socket);
        const user = classStateStore._users["logout@test.com"];
        expect(user.activeClass).toBeNull();
        expect(user.break).toBe(false);
        expect(user.help).toBe(false);
    });

    it("removes guest users from classStateStore on last session", () => {
        // GUEST_PERMISSIONS = 1
        classStateStore._users["guest@test.com"] = {
            email: "guest@test.com",
            permissions: 1,
            activeClass: null,
            break: false,
            help: false,
        };
        const socket = createMockSocket({
            id: "socket-guest",
            request: {
                session: {
                    email: "guest@test.com",
                    userId: 2,
                    classId: null,
                    destroy: jest.fn((cb) => cb(null)),
                },
            },
        });
        logout(socket);
        expect(classStateStore.removeUser).toHaveBeenCalledWith("guest@test.com");
    });
});

describe("deleteUser()", () => {
    it("returns 'User not found' when user does not exist", async () => {
        const result = await deleteUser(99999, {});
        expect(result).toBe("User not found");
    });

    it("deletes the user and associated data from the database", async () => {
        const seeded = await seedUser({ email: "delme@test.com" });
        await mockDatabase.dbRun("INSERT INTO classusers (classId, studentId) VALUES (?, ?)", [1, seeded.id]);
        await mockDatabase.dbRun("INSERT INTO shared_polls (userId, pollId) VALUES (?, ?)", [seeded.id, 1]);

        const result = await deleteUser(seeded.id, {});
        expect(result).toBe(true);

        const userRow = await mockDatabase.dbGet("SELECT * FROM users WHERE id = ?", [seeded.id]);
        expect(userRow).toBeUndefined();
        const classUserRows = await mockDatabase.dbGetAll("SELECT * FROM classusers WHERE studentId = ?", [seeded.id]);
        expect(classUserRows).toHaveLength(0);
    });

    it("calls managerUpdate after deletion", async () => {
        const seeded = await seedUser({ email: "delmgr@test.com" });
        await deleteUser(seeded.id, {});
        expect(managerUpdate).toHaveBeenCalled();
    });

    it("removes user from classStateStore if active", async () => {
        const seeded = await seedUser({ email: "delactive@test.com" });
        classStateStore._users[seeded.email] = {
            email: seeded.email,
            activeClass: 5,
        };
        classStateStore._classrooms[5] = {
            id: 5,
            students: { [seeded.email]: { email: seeded.email } },
        };

        await deleteUser(seeded.id, {});
        expect(classStateStore.removeUser).toHaveBeenCalledWith(seeded.email);
    });

    it("deletes temp_user_creation_data when user row not found but temp record exists", async () => {
        const tempSecret = "temp-secret-abc";
        await mockDatabase.dbRun("INSERT INTO temp_user_creation_data (token, secret) VALUES (?, ?)", ["tok1", tempSecret]);

        const result = await deleteUser(tempSecret, {});
        expect(result).toBe(true);

        const tempRow = await mockDatabase.dbGet("SELECT * FROM temp_user_creation_data WHERE secret = ?", [tempSecret]);
        expect(tempRow).toBeUndefined();
    });
});
