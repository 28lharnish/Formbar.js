const { compare, hash } = require("bcrypt");
const { dbGet, dbRun, dbGetAll } = require("@modules/database");
const { privateKey, publicKey } = require("@modules/config");
const { computeGlobalPermissionLevel, computeClassPermissionLevel, MANAGER_PERMISSIONS, STUDENT_PERMISSIONS } = require("@modules/permissions");
const { requireInternalParam } = require("@modules/error-wrapper");
const { sha256 } = require("@modules/crypto");
const { assertValidPassword } = require("@modules/password-validation");
const { getUserScopes } = require("@modules/scope-resolver");
const { classStateStore } = require("@services/classroom-service");
const { findRoleByPermissionLevel, getUserRoles } = require("@services/role-service");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const AppError = require("@errors/app-error");
const ValidationError = require("@errors/validation-error");
const ConflictError = require("@errors/conflict-error");

const displayRegex = /^[a-zA-Z0-9_ ]{5,20}$/;

async function normalizeUserData(userData) {
    if (!userData || !userData.id) {
        return userData;
    }

    const rolesFromDb = await getUserRoles(userData.id);
    const roles = {
        global: rolesFromDb.global,
        class: rolesFromDb.class,
    };

    const scopes = getUserScopes({ ...userData, roles });

    // If the user is in a class, then get their current class permissions
    let classPermissions = null;
    if (userData.activeClass) {
        classPermissions = (await getActiveClassContext({ ...userData, email: userData.email, roles })).classPermissions;
    }

    return {
        ...userData,
        permissions: computeGlobalPermissionLevel(scopes.global),
        classPermissions,
        roles,
        scopes,
    };
}

async function getActiveClassContext(user) {
    const roles = { global: user.roles?.global || [], class: [] };
    let scopes = { global: getUserScopes(user).global, class: [] };
    let classPermissions = null;

    const liveUser = classStateStore.getUser(user.email);
    if (!liveUser || !liveUser.activeClass) {
        return { roles, scopes, classPermissions };
    }

    const classroom = classStateStore.getClassroom(liveUser.activeClass);
    const classStudent = classroom?.students?.[user.email];
    const classroomOwnerId = classroom?.owner || (await dbGet("SELECT owner FROM classroom WHERE id = ?", [liveUser.activeClass]))?.owner;
    const effectiveClassUser = classStudent
        ? {
              ...classStudent,
              isClassOwner: classStudent.isClassOwner === true || user.id === classroomOwnerId,
          }
        : user.id === classroomOwnerId
          ? { id: user.id, email: user.email, roles: { global: user.roles?.global || [], class: [] }, isClassOwner: true }
          : null;

    if (classStudent) {
        roles.class = classStudent.roles?.class || [];
    }

    if (effectiveClassUser) {
        const resolved = getUserScopes(effectiveClassUser, classroom);
        scopes = { global: resolved.global, class: resolved.class };
        classPermissions = computeClassPermissionLevel(scopes.class, {
            isOwner: Boolean(effectiveClassUser.isClassOwner),
            globalScopes: resolved.global,
        });
    }

    return { roles, scopes, classPermissions };
}

function normalizeEmail(email) {
    return String(email).trim().toLowerCase();
}

function sanitizeDisplayName(displayName, email) {
    const fallback = String(email).split("@")[0] || "FormbarUser";
    const collapsed = String(displayName || fallback)
        .replace(/[^a-zA-Z0-9_ ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    let normalized = collapsed || fallback.replace(/[^a-zA-Z0-9_ ]+/g, "").trim() || "FormbarUser";
    if (normalized.length > 20) {
        normalized = normalized.slice(0, 20).trim();
    }

    if (normalized.length < 5) {
        normalized = `${normalized || "User"}_${crypto.randomBytes(4).toString("hex")}`.slice(0, 20);
    }

    normalized = normalized.replace(/\s+/g, " ").trim();

    if (!displayRegex.test(normalized)) {
        normalized = `User_${crypto.randomBytes(4).toString("hex")}`.slice(0, 20);
    }

    return normalized;
}

async function getUniqueDisplayName(displayName, email) {
    const baseName = sanitizeDisplayName(displayName, email);

    if (!(await dbGet("SELECT id FROM users WHERE displayName = ?", [baseName]))) {
        return baseName;
    }

    for (let suffix = 1; suffix <= 9999; suffix++) {
        const suffixText = String(suffix);
        const maxBaseLength = Math.max(1, 20 - suffixText.length - 1);
        const candidate = `${baseName.slice(0, maxBaseLength).trim() || "User"}_${suffixText}`;
        const existing = await dbGet("SELECT id FROM users WHERE displayName = ?", [candidate]);
        if (!existing) {
            return candidate;
        }
    }

    return `User_${crypto.randomBytes(4).toString("hex")}`.slice(0, 20);
}

async function createUser({ email, password, displayName, verified }) {
    const apiKey = crypto.randomBytes(64).toString("hex");
    const secret = crypto.randomBytes(256).toString("hex");

    const allUsers = await dbGetAll("SELECT * FROM users", []);
    const permissions = allUsers.length === 0 ? MANAGER_PERMISSIONS : STUDENT_PERMISSIONS;
    const uniqueDisplayName = await getUniqueDisplayName(displayName, email);

    const userId = await dbRun(`INSERT INTO users (email, password, API, secret, displayName, verified) VALUES (?, ?, ?, ?, ?, ?)`, [
        email,
        password || null,
        apiKey,
        secret,
        uniqueDisplayName,
        verified ? 1 : 0,
    ]);

    const role = await findRoleByPermissionLevel(permissions, null);
    if (role) {
        await dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, NULL)", [userId, role.id]);
    }

    return dbGet("SELECT * FROM users WHERE id = ?", [userId]);
}

async function issueAuthTokens(userData) {
    const tokens = generateAuthTokens(userData);
    const decodedRefreshToken = jwt.decode(tokens.refreshToken);
    const tokenHash = sha256(tokens.refreshToken);

    await dbRun("INSERT INTO refresh_tokens (user_id, token_hash, exp, token_type) VALUES (?, ?, ?, ?)", [
        userData.id,
        tokenHash,
        decodedRefreshToken.exp,
        "auth",
    ]);

    return {
        ...tokens,
    };
}

/**
 * Registers a new user with email and password
 * @async
 * @param {string} email - The user's email address
 * @param {string} password - The user's plain text password
 * @param {string} displayName - The user's display name
 * @returns {Promise<{tokens: {accessToken: string, refreshToken: string}, user: Object}|{error: string}>} Returns an object with tokens and user data on success, or an error object on failure
 */
async function register(email, password, displayName) {
    if (!privateKey || !publicKey) {
        throw new AppError("Either the public key or private key is not available for JWT signing.", {
            event: "auth.register.failed",
            reason: "missing_keys",
        });
    }

    assertValidPassword(password, { event: "auth.register.failed", reason: "invalid_password" });

    if (!displayRegex.test(displayName)) {
        throw new ValidationError("Display name must be 5-20 characters long and can only contain letters, numbers, spaces, and underscores.", {
            event: "auth.register.failed",
            reason: "invalid_display_name",
        });
    }

    // Normalize email to lowercase to prevent duplicate accounts
    email = normalizeEmail(email);

    // Check if user already exists
    const existingUser = await dbGet("SELECT * FROM users WHERE email = ? OR displayName = ?", [email, displayName]);
    if (existingUser) {
        throw new ConflictError("A user with that email or display name already exists.", { event: "auth.register.failed", reason: "user_exists" });
    }

    const hashedPassword = await hash(password, 10);
    const userData = await normalizeUserData(
        await createUser({
            email,
            password: hashedPassword,
            displayName,
            verified: 0,
        })
    );

    // Generate tokens
    const tokens = await issueAuthTokens(userData);

    return { tokens, user: userData };
}

/**
 * Authenticates a user with email and password credentials
 * @async
 * @param {string} email - The user's email address
 * @param {string} password - The user's plain text password
 * @returns {Promise<{tokens: {accessToken: string, refreshToken: string}, user: Object}|Error>} Returns an object with tokens and user data on success, or an Error object with code 'INVALID_CREDENTIALS' on failure
 * @throws {Error} Throws an error if private key is not available
 */
async function login(email, password) {
    if (!privateKey || !publicKey) {
        throw new AppError("Either the public key or private key is not available for JWT signing.", {
            statusCode: 500,
            event: "auth.login.failed",
            reason: "missing_keys",
        });
    }

    // Normalize email to lowercase to prevent login issues
    email = normalizeEmail(email);

    const userData = await normalizeUserData(await dbGet("SELECT * FROM users WHERE email = ?", [email]));
    if (!userData) {
        return invalidCredentials();
    }

    if (!userData.password) {
        return invalidCredentials();
    }

    const passwordMatches = await compare(password, userData.password);
    if (passwordMatches) {
        return { tokens: await issueAuthTokens(userData), user: userData };
    } else {
        return invalidCredentials();
    }
}

/**
 * Refreshes user authentication using a refresh token
 * @async
 * @param {string} refreshToken - The refresh token to validate and use for generating new tokens
 * @returns {Promise<{accessToken: string, refreshToken: string}|Error>} Returns an object with accessToken and refreshToken on success, or an Error object with code 'INVALID_CREDENTIALS' if the refresh token is invalid
 */
async function refreshLogin(refreshToken) {
    // Verify the refresh token's signature and expiration before proceeding
    // This prevents the use of expired or tampered tokens
    try {
        jwt.verify(refreshToken, publicKey, { algorithms: ["RS256"] });
    } catch (err) {
        return invalidCredentials();
    }

    const tokenHash = sha256(refreshToken);
    const dbRefreshToken = await dbGet("SELECT * FROM refresh_tokens WHERE token_hash = ? AND token_type = 'auth'", [tokenHash]);
    if (!dbRefreshToken) {
        return invalidCredentials();
    }

    // Load user data to include email and displayName in the new token
    const userData = await normalizeUserData(await dbGet("SELECT id, email, displayName FROM users WHERE id = ?", [dbRefreshToken.user_id]));
    if (!userData) {
        return invalidCredentials();
    }

    const authTokens = generateAuthTokens(userData);
    const decodedRefreshToken = jwt.decode(authTokens.refreshToken);

    // Delete the old refresh token and insert the new one to avoid UNIQUE constraint issues
    // This handles cases where a user might have multiple refresh tokens in the database
    const newTokenHash = sha256(authTokens.refreshToken);
    await dbRun("DELETE FROM refresh_tokens WHERE token_hash = ?", [tokenHash]);
    await dbRun("INSERT INTO refresh_tokens (user_id, token_hash, exp, token_type) VALUES (?, ?, ?, ?)", [
        dbRefreshToken.user_id,
        newTokenHash,
        decodedRefreshToken.exp,
        "auth",
    ]);

    return authTokens;
}

/**
 * Generates both access and refresh tokens for a user
 * @param {Object} userData - The user data object
 * @param {number} userData.id - The user's unique identifier
 * @param {string} [userData.email] - The user's email address (used in access token)
 * @param {string} [userData.displayName] - The user's display name (optional, used in access token)
 * @returns {{accessToken: string, refreshToken: string}} An object containing both access and refresh tokens
 */
function generateAuthTokens(userData) {
    const refreshToken = generateRefreshToken(userData);
    const accessToken = jwt.sign(
        {
            id: userData.id,
            email: userData.email,
            displayName: userData.displayName,
            permissions: userData.permissions,
            scopes: getUserScopes(userData),
        },
        privateKey,
        { algorithm: "RS256", expiresIn: "15m" }
    );

    return { accessToken, refreshToken };
}

/**
 * Issues a short-lived access token for a global guest (no DB user, no refresh token).
 * @param {{ id: string|number, email: string, displayName: string, digipogs?: number, permissions: number }} userData
 * @returns {{ accessToken: string }}
 */
function loginAsGuest(userData) {
    if (!privateKey || !publicKey) {
        throw new AppError("Either the public key or private key is not available for JWT signing.", {
            statusCode: 500,
            event: "auth.guest.failed",
            reason: "missing_keys",
        });
    }

    const scopes = { global: [], class: [] };
    const accessToken = jwt.sign(
        {
            id: userData.id,
            email: userData.email,
            displayName: userData.displayName,
            isGuest: true,
            digipogs: userData.digipogs ?? 0,
            permissions: userData.permissions,
            scopes,
        },
        privateKey,
        { algorithm: "RS256", expiresIn: "15m" }
    );

    return { accessToken };
}

/**
 * Generates a refresh token for a user
 * @param {Object} userData - The user data object
 * @param {number} userData.id - The user's unique identifier
 * @returns {string} A JWT refresh token valid for 30 days
 */
function generateRefreshToken(userData) {
    return jwt.sign({ id: userData.id, jti: crypto.randomBytes(16).toString("hex") }, privateKey, { algorithm: "RS256", expiresIn: "30d" });
}

/**
 * Verifies the validity of an access token and returns the decoded payload
 * @param {string} token - The JWT access token to verify
 * @returns {Object|{error: string}} Decoded token payload if verification succeeds, or an object with an error property if verification fails
 */
function verifyToken(token) {
    try {
        return jwt.verify(token, publicKey, { algorithms: ["RS256"] });
    } catch (err) {
        return { error: err.toString() };
    }
}

/**
 * Creates a standardized error object for invalid credentials
 * @returns {Error} An Error object with message "Invalid credentials" and code "INVALID_CREDENTIALS"
 */
function invalidCredentials() {
    const err = new Error("Invalid credentials");
    err.code = "INVALID_CREDENTIALS";
    return err;
}

/**
 * Authenticates or registers a user via OpenID with services like Google and Microsoft
 * @async
 * @param {string} email - The user's email address from Google
 * @param {string} displayName - The user's display name from Google
 * @returns {Promise<{tokens: {accessToken: string, refreshToken: string}, user: Object}|{error: string}>} Returns an object with tokens and user data on success, or an error object on failure
 */
async function oidcOAuthLogin(provider, email, displayName, options = {}) {
    if (!privateKey || !publicKey) {
        throw new AppError("Either the public key or private key is not available for JWT signing.", {
            statusCode: 500,
            event: "auth.oauth.failed",
            reason: "missing_keys",
        });
    }

    // Normalize email to lowercase to prevent duplicate accounts
    email = normalizeEmail(email);

    let userData = await dbGet("SELECT * FROM users WHERE email = ?", [email]);
    if (!userData) {
        userData = await createUser({
            email,
            password: null,
            displayName,
            verified: 1,
        });
    } else {
        const updates = [];
        const params = [];

        if (!userData.displayName) {
            updates.push("displayName = ?");
            params.push(await getUniqueDisplayName(displayName, email));
        }

        if (!userData.verified && options.emailVerified !== false) {
            updates.push("verified = 1");
        }

        if (updates.length > 0) {
            params.push(userData.id);
            await dbRun(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);
            userData = await dbGet("SELECT * FROM users WHERE id = ?", [userData.id]);
        }
    }

    userData = await normalizeUserData(userData);
    return { provider, tokens: await issueAuthTokens(userData), user: userData };
}

/**
 * Creates an authorization code for OAuth 2.0 authorization flow
 * @param {Object} params - The authorization parameters
 * @param {string} params.client_id - The client application's ID
 * @param {string} params.redirect_uri - The redirect URI
 * @param {string} params.scope - The requested scopes
 * @param {string} params.authorization - The user's authorization token
 * @returns {string} A newly generated authorization code
 */
function generateAuthorizationCode({ client_id, redirect_uri, scope, authorization }) {
    requireInternalParam(client_id, "client_id");
    requireInternalParam(redirect_uri, "redirect_uri");
    requireInternalParam(scope, "scope");
    requireInternalParam(authorization, "authorization");

    const userData = verifyToken(authorization);
    if (userData.error) {
        throw new AppError("Invalid authorization token provided.", { statusCode: 400 });
    }

    return jwt.sign(
        {
            sub: userData.id,
            aud: client_id,
            redirect_uri: redirect_uri,
            scope: scope,
        },
        privateKey,
        { algorithm: "RS256", expiresIn: "5m" }
    );
}

/**
 * Exchanges an authorization code for access and refresh tokens
 * @async
 * @param {Object} params - The token exchange parameters
 * @param {string} params.code - The authorization code
 * @param {string} params.redirect_uri - The redirect URI (must match original)
 * @param {string} params.client_id - The client application's ID
 * @returns {Promise<Object>} Token response with access_token, token_type, expires_in, and refresh_token
 */
async function exchangeAuthorizationCodeForToken({ code, redirect_uri, client_id }) {
    requireInternalParam(code, "code");
    requireInternalParam(redirect_uri, "redirect_uri");
    requireInternalParam(client_id, "client_id");

    const authorizationCodeData = verifyToken(code);
    if (authorizationCodeData.error) {
        throw new AppError("Invalid authorization code provided.", { statusCode: 400 });
    }

    // Check if the authorization code has already been used (single-use per RFC 6749 Section 10.5)
    const codeHash = sha256(code);
    const usedCode = await dbGet("SELECT * FROM used_authorization_codes WHERE code_hash = ?", [codeHash]);
    if (usedCode) {
        throw new AppError("Authorization code has already been used.", { statusCode: 400 });
    }

    // Mark the authorization code as used
    await dbRun("INSERT INTO used_authorization_codes (code_hash, used_at, expires_at) VALUES (?, ?, ?)", [
        codeHash,
        Math.floor(Date.now() / 1000),
        authorizationCodeData.exp,
    ]);

    // Ensure the redirect_uri and client_id match those embedded in the authorization code
    if (authorizationCodeData.redirect_uri !== redirect_uri) {
        throw new AppError("redirect_uri does not match the original authorization request.", { statusCode: 400 });
    }
    if (authorizationCodeData.aud !== client_id) {
        throw new AppError("client_id does not match the original authorization request.", { statusCode: 400 });
    }

    // Load user details so the OAuth access token includes the same claims as regular access tokens
    const user = await normalizeUserData(await dbGet("SELECT id, email, displayName FROM users WHERE id = ?", [authorizationCodeData.sub]));
    if (!user) {
        throw new AppError("User associated with the authorization code was not found.", { statusCode: 404 });
    }

    const tokenPayload = {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
    };

    const accessToken = jwt.sign(tokenPayload, privateKey, { algorithm: "RS256", expiresIn: "15m" });
    const refreshToken = jwt.sign({ id: user.id }, privateKey, { algorithm: "RS256", expiresIn: "30d" });
    const decodedRefreshToken = jwt.decode(refreshToken);

    // Persist the OAuth refresh token to the database (store hash, not cleartext)
    const refreshTokenHash = sha256(refreshToken);
    await dbRun("INSERT INTO refresh_tokens (user_id, token_hash, exp, token_type) VALUES (?, ?, ?, ?)", [
        authorizationCodeData.sub,
        refreshTokenHash,
        decodedRefreshToken.exp,
        "oauth",
    ]);

    const { roles: activeRoles, scopes: activeScopes, classPermissions } = await getActiveClassContext(user);

    return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 900,
        refresh_token: refreshToken,
        permissions: user.permissions,
        classPermissions,
        role: user.role,
        roles: activeRoles,
        scopes: activeScopes,
    };
}

/**
 * Exchanges a refresh token for a new access token and refresh token
 * @async
 * @param {Object} params - The token refresh parameters
 * @param {string} params.refresh_token - The refresh token to exchange
 * @returns {Promise<Object>} Token response with access_token, token_type, expires_in, and refresh_token
 */
async function exchangeRefreshTokenForAccessToken({ refresh_token }) {
    requireInternalParam(refresh_token, "refresh_token");

    const refreshTokenData = verifyToken(refresh_token);
    if (refreshTokenData.error) {
        throw new AppError("Invalid refresh token provided.", { statusCode: 400 });
    }

    // Verify the refresh token exists in the database as an OAuth token (compare hashes)
    const tokenHash = sha256(refresh_token);
    const dbRefreshToken = await dbGet("SELECT * FROM refresh_tokens WHERE token_hash = ? AND token_type = 'oauth'", [tokenHash]);
    if (!dbRefreshToken) {
        throw new AppError("Refresh token not found or has been revoked.", { statusCode: 401 });
    }

    // Load user details so the OAuth access token includes the same claims as regular access tokens
    const user = await normalizeUserData(await dbGet("SELECT id, email, displayName FROM users WHERE id = ?", [refreshTokenData.id]));
    if (!user) {
        throw new AppError("User associated with the refresh token was not found.", { statusCode: 404 });
    }

    const tokenPayload = {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
    };

    const accessToken = jwt.sign(tokenPayload, privateKey, { algorithm: "RS256", expiresIn: "15m" });
    const newRefreshToken = jwt.sign(tokenPayload, privateKey, { algorithm: "RS256", expiresIn: "30d" });
    const decodedRefreshToken = jwt.decode(newRefreshToken);

    // Rotate the refresh token: delete old, insert new (store hash, not cleartext)
    const newTokenHash = sha256(newRefreshToken);
    await dbRun("DELETE FROM refresh_tokens WHERE token_hash = ?", [tokenHash]);
    await dbRun("INSERT INTO refresh_tokens (user_id, token_hash, exp, token_type) VALUES (?, ?, ?, ?)", [
        refreshTokenData.id,
        newTokenHash,
        decodedRefreshToken.exp,
        "oauth",
    ]);

    const { classPermissions } = await getActiveClassContext(user);

    return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 900,
        refresh_token: newRefreshToken,
        permissions: user.permissions,
        classPermissions,
        role: user.role,
        scopes: getUserScopes(user),
    };
}

/**
 * Revokes an OAuth refresh token
 * @async
 * @param {string} token - The refresh token to revoke
 * @returns {Promise<boolean>} Returns true if revocation was successful
 */
async function revokeOAuthToken(token) {
    requireInternalParam(token, "token");

    // Delete the token from the database (only OAuth tokens, compare by hash)
    const tokenHash = sha256(token);
    await dbRun("DELETE FROM refresh_tokens WHERE token_hash = ? AND token_type = 'oauth'", [tokenHash]);
    return true;
}

/**
 * Cleans up expired authorization codes from the database.
 * Should be called periodically to prevent table bloat.
 * @async
 * @returns {Promise<void>}
 */
async function cleanupExpiredAuthorizationCodes() {
    const now = Math.floor(Date.now() / 1000);
    await dbRun("DELETE FROM used_authorization_codes WHERE expires_at < ?", [now]);
}

module.exports = {
    register,
    login,
    loginAsGuest,
    refreshLogin,
    verifyToken,
    oidcOAuthLogin,
    generateAuthorizationCode,
    exchangeAuthorizationCodeForToken,
    exchangeRefreshTokenForAccessToken,
    revokeOAuthToken,
    cleanupExpiredAuthorizationCodes,
    sanitizeDisplayName,
};
