const { createTestDb } = require("@test-helpers/db");
const { addClassMemberWithPermission } = require("@test-helpers/role-seeding");
const { classStateStore } = require("@services/classroom-service");

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
        rateLimit: {
            maxAttempts: 5,
            lockoutDuration: 900000,
            minDelayBetweenAttempts: 1000,
            attemptWindow: 300000,
        },
    };
});

jest.mock("@modules/mail", () => ({ sendMail: jest.fn() }));

const {
    register,
    login,
    oidcOAuthLogin,
    refreshLogin,
    verifyToken,
    generateAuthorizationCode,
    exchangeAuthorizationCodeForToken,
    exchangeRefreshTokenForAccessToken,
    revokeOAuthToken,
    cleanupExpiredAuthorizationCodes,
} = require("@services/auth-service");
const { sha256 } = require("@modules/crypto");

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    const state = classStateStore.getRawState();
    for (const key of Object.keys(state.users)) {
        delete state.users[key];
    }
    for (const key of Object.keys(state.classrooms)) {
        delete state.classrooms[key];
    }
});

afterAll(async () => {
    await mockDatabase.close();
});

const VALID_EMAIL = "test@example.com";
const VALID_PASSWORD = "Pass1234!";
const VALID_DISPLAY = "TestUser";

async function seedUser(overrides = {}) {
    return register(overrides.email ?? VALID_EMAIL, overrides.password ?? VALID_PASSWORD, overrides.displayName ?? VALID_DISPLAY);
}

describe("sha256()", () => {
    it("returns a 64-character hex string", () => {
        const result = sha256("some-token");
        expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is deterministic for the same input", () => {
        expect(sha256("abc")).toBe(sha256("abc"));
    });

    it("produces different hashes for different inputs", () => {
        expect(sha256("token-a")).not.toBe(sha256("token-b"));
    });
});

describe("register()", () => {
    it("assigns the first user the Manager role", async () => {
        const result = await register(VALID_EMAIL, VALID_PASSWORD, VALID_DISPLAY);
        const role = await mockDatabase.dbGet(
            "SELECT r.name FROM user_roles ur JOIN roles r ON ur.roleId = r.id WHERE ur.userId = ? AND ur.classId IS NULL",
            [result.user.id]
        );
        expect(role.name).toBe("Manager");
    });

    it("assigns subsequent users the Student role", async () => {
        await register(VALID_EMAIL, VALID_PASSWORD, VALID_DISPLAY);
        const second = await register("second@example.com", VALID_PASSWORD, "SecondUser");
        const role = await mockDatabase.dbGet(
            "SELECT r.name FROM user_roles ur JOIN roles r ON ur.roleId = r.id WHERE ur.userId = ? AND ur.classId IS NULL",
            [second.user.id]
        );
        expect(role.name).toBe("Student");
    });

    it("returns accessToken and refreshToken", async () => {
        const { tokens } = await register(VALID_EMAIL, VALID_PASSWORD, VALID_DISPLAY);
        expect(tokens).toHaveProperty("accessToken");
        expect(tokens).toHaveProperty("refreshToken");
        expect(typeof tokens.accessToken).toBe("string");
        expect(typeof tokens.refreshToken).toBe("string");
    });

    it("returns the new user's data", async () => {
        const { user } = await register(VALID_EMAIL, VALID_PASSWORD, VALID_DISPLAY);
        expect(user.email).toBe(VALID_EMAIL);
        expect(user.displayName).toBe(VALID_DISPLAY);
        expect(user).toHaveProperty("id");
    });

    it("normalises email to lowercase", async () => {
        const { user } = await register("UPPER@EXAMPLE.COM", VALID_PASSWORD, VALID_DISPLAY);
        expect(user.email).toBe("upper@example.com");
    });

    it("stores a hashed (not plaintext) password", async () => {
        await register(VALID_EMAIL, VALID_PASSWORD, VALID_DISPLAY);
        const row = await mockDatabase.dbGet("SELECT password FROM users WHERE email = ?", [VALID_EMAIL]);
        expect(row.password).not.toBe(VALID_PASSWORD);
        expect(row.password.startsWith("$2b$")).toBe(true);
    });

    it("persists a refresh token in the refresh_tokens table", async () => {
        await register(VALID_EMAIL, VALID_PASSWORD, VALID_DISPLAY);
        const rows = await mockDatabase.dbGetAll("SELECT * FROM refresh_tokens");
        expect(rows).toHaveLength(1);
        expect(rows[0].token_type).toBe("auth");
    });

    it("throws ValidationError for a password that is too short", async () => {
        await expect(register(VALID_EMAIL, "abc", VALID_DISPLAY)).rejects.toThrow(/password/i);
    });

    it("throws ValidationError for a password that is too long (>20 chars)", async () => {
        await expect(register(VALID_EMAIL, "a".repeat(21), VALID_DISPLAY)).rejects.toThrow(/password/i);
    });

    it("throws ValidationError for an invalid displayName (too short)", async () => {
        await expect(register(VALID_EMAIL, VALID_PASSWORD, "ab")).rejects.toThrow(/display name/i);
    });

    it("throws ValidationError for a displayName that is too long (>20 chars)", async () => {
        await expect(register(VALID_EMAIL, VALID_PASSWORD, "a".repeat(21))).rejects.toThrow(/display name/i);
    });

    it("throws ConflictError when email already exists", async () => {
        await register(VALID_EMAIL, VALID_PASSWORD, VALID_DISPLAY);
        await expect(register(VALID_EMAIL, VALID_PASSWORD, "OtherUser")).rejects.toThrow(/already exists/i);
    });

    it("throws ConflictError when displayName already exists", async () => {
        await register(VALID_EMAIL, VALID_PASSWORD, VALID_DISPLAY);
        await expect(register("other@example.com", VALID_PASSWORD, VALID_DISPLAY)).rejects.toThrow(/already exists/i);
    });
});

describe("login()", () => {
    beforeEach(async () => {
        await seedUser();
    });

    it("returns tokens and user on valid credentials", async () => {
        const result = await login(VALID_EMAIL, VALID_PASSWORD);
        expect(result).toHaveProperty("tokens");
        expect(result.tokens).toHaveProperty("accessToken");
        expect(result.tokens).toHaveProperty("refreshToken");
        expect(result.user.email).toBe(VALID_EMAIL);
        expect(result.user.classPermissions).toBeNull();
    });

    it("inserts a refresh token into the database", async () => {
        const before = await mockDatabase.dbGetAll("SELECT * FROM refresh_tokens WHERE token_type = 'auth'");
        await login(VALID_EMAIL, VALID_PASSWORD);
        const after = await mockDatabase.dbGetAll("SELECT * FROM refresh_tokens WHERE token_type = 'auth'");
        expect(after.length).toBeGreaterThan(before.length);
    });

    it("normalises email to lowercase before looking up", async () => {
        const result = await login("TEST@EXAMPLE.COM", VALID_PASSWORD);
        expect(result).toHaveProperty("user");
        expect(result.user.email).toBe(VALID_EMAIL);
    });

    it("returns an INVALID_CREDENTIALS error for wrong password", async () => {
        const result = await login(VALID_EMAIL, "wrong-password!");
        expect(result).toBeInstanceOf(Error);
        expect(result.code).toBe("INVALID_CREDENTIALS");
    });

    it("returns an INVALID_CREDENTIALS error for non-existent email", async () => {
        const result = await login("nobody@example.com", VALID_PASSWORD);
        expect(result).toBeInstanceOf(Error);
        expect(result.code).toBe("INVALID_CREDENTIALS");
    });

    it("returns INVALID_CREDENTIALS for OAuth-only accounts without a password", async () => {
        await oidcOAuthLogin("microsoft", "oauth-only@example.com", VALID_DISPLAY, { emailVerified: true });

        const result = await login("oauth-only@example.com", VALID_PASSWORD);
        expect(result).toBeInstanceOf(Error);
        expect(result.code).toBe("INVALID_CREDENTIALS");
    });
});

describe("oidcOAuthLogin()", () => {
    it("creates a verified user with a nullable password", async () => {
        const result = await oidcOAuthLogin("microsoft", "oauth@example.com", "OAuth User", { emailVerified: true });

        expect(result.user.email).toBe("oauth@example.com");
        expect(result.user.verified).toBe(1);
        expect(result.user.password).toBeNull();
    });

    it("links to an existing email/password account instead of creating a duplicate", async () => {
        const seeded = await seedUser();

        const result = await oidcOAuthLogin("google", VALID_EMAIL, "Different Name", { emailVerified: true });
        const users = await mockDatabase.dbGetAll("SELECT * FROM users WHERE email = ?", [VALID_EMAIL]);

        expect(users).toHaveLength(1);
        expect(result.user.id).toBe(seeded.user.id);
        expect(result.user.password).toBeTruthy();
    });

    it("marks an existing account as verified when the provider confirms the email", async () => {
        const seeded = await seedUser();
        await mockDatabase.dbRun("UPDATE users SET verified = 0 WHERE id = ?", [seeded.user.id]);

        const result = await oidcOAuthLogin("microsoft", VALID_EMAIL, VALID_DISPLAY, { emailVerified: true });
        expect(result.user.verified).toBe(1);
    });

    it("generates a unique display name when the provider name already exists", async () => {
        await seedUser({ displayName: "OAuth User" });

        const result = await oidcOAuthLogin("google", "another@example.com", "OAuth User", { emailVerified: true });
        expect(result.user.displayName).not.toBe("OAuth User");
        expect(result.user.displayName).toMatch(/^OAuth User_/);
    });
});

describe("verifyToken()", () => {
    it("returns decoded payload for a valid access token", async () => {
        const { tokens, user } = await seedUser();
        const decoded = verifyToken(tokens.accessToken);
        expect(decoded).toHaveProperty("id", user.id);
        expect(decoded).toHaveProperty("email", VALID_EMAIL);
    });

    it("keeps global and class scopes split in the access token payload", async () => {
        await seedUser();

        const loginResult = await login(VALID_EMAIL, VALID_PASSWORD);
        const decoded = verifyToken(loginResult.tokens.accessToken);

        expect(decoded.scopes.global).toEqual(expect.arrayContaining(["global.pools.manage", "global.digipogs.transfer"]));
        expect(decoded.scopes.global).not.toEqual(expect.arrayContaining(["class.poll.read", "class.poll.vote"]));
        expect(decoded.scopes.class).toEqual([]);
    });

    it("returns an error object for a malformed token", () => {
        const result = verifyToken("not.a.valid.token");
        expect(result).toHaveProperty("error");
    });

    it("returns an error object for an empty string", () => {
        const result = verifyToken("");
        expect(result).toHaveProperty("error");
    });
});

describe("refreshLogin()", () => {
    it("returns a new pair of tokens for a valid refresh token", async () => {
        const { tokens } = await seedUser();
        const result = await refreshLogin(tokens.refreshToken);
        expect(result).toHaveProperty("accessToken");
        expect(result).toHaveProperty("refreshToken");
    });

    it("rotates the refresh token (old token is no longer valid)", async () => {
        const { tokens } = await seedUser();
        await refreshLogin(tokens.refreshToken);
        // Using the old refresh token again should fail
        const second = await refreshLogin(tokens.refreshToken);
        expect(second).toBeInstanceOf(Error);
        expect(second.code).toBe("INVALID_CREDENTIALS");
    });

    it("returns INVALID_CREDENTIALS for a completely invalid token", async () => {
        const result = await refreshLogin("not-a-jwt");
        expect(result).toBeInstanceOf(Error);
        expect(result.code).toBe("INVALID_CREDENTIALS");
    });

    it("returns INVALID_CREDENTIALS for a token not present in the DB", async () => {
        // Generate a valid-looking token from the same keys but never stored
        const { tokens } = await seedUser();
        // Log out (clear DB) so the token is unknown
        await mockDatabase.dbRun("DELETE FROM refresh_tokens");
        const result = await refreshLogin(tokens.refreshToken);
        expect(result).toBeInstanceOf(Error);
        expect(result.code).toBe("INVALID_CREDENTIALS");
    });
});

describe("OAuth authorization code flow", () => {
    it("generates and exchanges an authorization code successfully", async () => {
        const { tokens, user } = await seedUser();

        const code = generateAuthorizationCode({
            client_id: "test-app",
            redirect_uri: "http://localhost/callback",
            scope: "openid",
            authorization: tokens.accessToken,
        });

        expect(typeof code).toBe("string");

        const tokenResponse = await exchangeAuthorizationCodeForToken({
            code,
            redirect_uri: "http://localhost/callback",
            client_id: "test-app",
        });

        expect(tokenResponse).toHaveProperty("access_token");
        expect(tokenResponse).toHaveProperty("refresh_token");
        expect(tokenResponse.token_type).toBe("Bearer");
        expect(tokenResponse.expires_in).toBe(900);
    });

    it("returns classPermissions in OAuth token responses for users in an active class", async () => {
        const { tokens, user } = await seedUser();
        const classId = await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", ["OAuth Class", user.id + 1000, 2468]);
        await addClassMemberWithPermission(mockDatabase, user.id, classId, 4);

        classStateStore.setUser(user.email, {
            id: user.id,
            email: user.email,
            activeClass: classId,
        });
        classStateStore.setClassroom(classId, {
            id: classId,
            owner: user.id + 1000,
            students: {
                [user.email]: {
                    email: user.email,
                    roles: { global: [], class: ["Teacher"] },
                },
            },
        });

        const code = generateAuthorizationCode({
            client_id: "test-app",
            redirect_uri: "http://localhost/callback",
            scope: "openid",
            authorization: tokens.accessToken,
        });

        const tokenResponse = await exchangeAuthorizationCodeForToken({
            code,
            redirect_uri: "http://localhost/callback",
            client_id: "test-app",
        });
        expect(tokenResponse.classPermissions).toBe(4);

        const refreshed = await exchangeRefreshTokenForAccessToken({
            refresh_token: tokenResponse.refresh_token,
        });
        expect(refreshed.classPermissions).toBe(4);
    });

    it("rejects a code that has already been used (single-use enforcement)", async () => {
        const { tokens } = await seedUser();

        const code = generateAuthorizationCode({
            client_id: "test-app",
            redirect_uri: "http://localhost/callback",
            scope: "openid",
            authorization: tokens.accessToken,
        });

        await exchangeAuthorizationCodeForToken({
            code,
            redirect_uri: "http://localhost/callback",
            client_id: "test-app",
        });

        await expect(
            exchangeAuthorizationCodeForToken({
                code,
                redirect_uri: "http://localhost/callback",
                client_id: "test-app",
            })
        ).rejects.toThrow(/already been used/i);
    });

    it("rejects a code with a mismatched redirect_uri", async () => {
        const { tokens } = await seedUser();

        const code = generateAuthorizationCode({
            client_id: "test-app",
            redirect_uri: "http://localhost/callback",
            scope: "openid",
            authorization: tokens.accessToken,
        });

        await expect(
            exchangeAuthorizationCodeForToken({
                code,
                redirect_uri: "http://localhost/different",
                client_id: "test-app",
            })
        ).rejects.toThrow(/redirect_uri/i);
    });

    it("rejects a code with a mismatched client_id", async () => {
        const { tokens } = await seedUser();

        const code = generateAuthorizationCode({
            client_id: "test-app",
            redirect_uri: "http://localhost/callback",
            scope: "openid",
            authorization: tokens.accessToken,
        });

        await expect(
            exchangeAuthorizationCodeForToken({
                code,
                redirect_uri: "http://localhost/callback",
                client_id: "other-app",
            })
        ).rejects.toThrow(/client_id/i);
    });

    it("throws when authorization token is invalid", () => {
        expect(() =>
            generateAuthorizationCode({
                client_id: "test-app",
                redirect_uri: "http://localhost/callback",
                scope: "openid",
                authorization: "invalid-token",
            })
        ).toThrow();
    });
});

describe("revokeOAuthToken()", () => {
    it("removes the token from the refresh_tokens table", async () => {
        const { tokens, user } = await seedUser();

        // Inject an OAuth-type refresh token manually
        const crypto = require("crypto");
        const fakeToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = sha256(fakeToken);
        await mockDatabase.dbRun("INSERT INTO refresh_tokens (user_id, token_hash, exp, token_type) VALUES (?, ?, ?, ?)", [
            user.id,
            tokenHash,
            Math.floor(Date.now() / 1000) + 3600,
            "oauth",
        ]);

        const before = await mockDatabase.dbGetAll("SELECT * FROM refresh_tokens WHERE token_type = 'oauth'");
        expect(before).toHaveLength(1);

        await revokeOAuthToken(fakeToken);

        const after = await mockDatabase.dbGetAll("SELECT * FROM refresh_tokens WHERE token_type = 'oauth'");
        expect(after).toHaveLength(0);
    });

    it("returns true on success", async () => {
        const result = await revokeOAuthToken("non-existent-token-that-does-not-matter");
        expect(result).toBe(true);
    });
});

describe("cleanupExpiredAuthorizationCodes()", () => {
    it("deletes expired authorization codes", async () => {
        const pastTimestamp = Math.floor(Date.now() / 1000) - 3600;
        await mockDatabase.dbRun("INSERT INTO used_authorization_codes (code_hash, used_at, expires_at) VALUES (?, ?, ?)", [
            "expired-hash",
            pastTimestamp,
            pastTimestamp,
        ]);

        const before = await mockDatabase.dbGetAll("SELECT * FROM used_authorization_codes");
        expect(before).toHaveLength(1);

        await cleanupExpiredAuthorizationCodes();

        const after = await mockDatabase.dbGetAll("SELECT * FROM used_authorization_codes");
        expect(after).toHaveLength(0);
    });

    it("keeps non-expired authorization codes", async () => {
        const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;
        await mockDatabase.dbRun("INSERT INTO used_authorization_codes (code_hash, used_at, expires_at) VALUES (?, ?, ?)", [
            "valid-hash",
            Math.floor(Date.now() / 1000),
            futureTimestamp,
        ]);

        await cleanupExpiredAuthorizationCodes();

        const remaining = await mockDatabase.dbGetAll("SELECT * FROM used_authorization_codes");
        expect(remaining).toHaveLength(1);
    });
});
