const { getLogger } = require("@modules/logger");
const { classStateStore } = require("@services/classroom-service");
const { settings } = require("@modules/config");
const { dbGet, dbRun } = require("@modules/database");
const { createStudentFromUserData } = require("@services/student-service");
const { getUserDataFromDb } = require("@services/user-service");
const { resolveAPIKey } = require("@services/api-key-service");
const { verifyToken, cleanupExpiredAuthorizationCodes } = require("@services/auth-service");
const AuthError = require("@errors/auth-error");

const whitelistedIps = {};
const blacklistedIps = {};

// Removes expired refresh tokens and authorization codes from the database
/**
 * Clean Refresh Tokens.
 *
 * @returns {Promise<*>}
 */
async function cleanRefreshTokens() {
    try {
        const nowInSeconds = Math.floor(Date.now() / 1000);
        await dbRun("DELETE FROM refresh_tokens WHERE exp <= ?", [nowInSeconds]);
        // Also clean up expired authorization codes
        await cleanupExpiredAuthorizationCodes();
    } catch (err) {
        const logger = await getLogger();
        logger.error({
            event: "auth.cleanup.error",
            message: "Failed to clean up expired refresh tokens or authorization codes",
            error: err.message,
            stack: err.stack,
        });
    }
}

/**
 * Load the persisted user record when in-memory session state is stale.
 *
 * @param {*} email - email.
 * @returns {Promise<*>}
 */
async function loadComputedUserByEmail(email) {
    const userRow = await dbGet("SELECT id FROM users WHERE email = ?", [email]);
    if (!userRow) {
        return null;
    }

    return getUserDataFromDb(userRow.id);
}

/**
 * Synchronize User Into Class State Store.
 *
 * @param {*} userData - userData.
 * @returns {*}
 */
function syncUserIntoClassStateStore(userData) {
    let user = classStateStore.getUser(userData.email);

    if (!user) {
        user = createStudentFromUserData(userData, { isGuest: false });
        classStateStore.setUser(userData.email, user);
        return user;
    }

    classStateStore.updateUser(userData.email, {
        id: userData.id,
        API: userData.API,
        displayName: userData.displayName,
        verified: userData.verified,
        role: userData.role,
        roles: userData.roles || { global: [], class: [] },
        permissions: userData.permissions,
    });

    return classStateStore.getUser(userData.email);
}

/**
 * Middleware to verify that a user is authenticated.
 *
 * Place at the start of any route that requires an authenticated user.
 * Verifies the Authorization header, decodes the access token and attaches
 * user information to `req.user` for downstream handlers.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express next middleware function.
 * @throws {AuthError} When no token is provided, the token is invalid,
 *                     the token is missing an email, or the user is not found.
 * @returns {void}
 */
async function isAuthenticated(req, res, next) {
    // Check if an API key is provided
    // If it is, then authenticate via an API key. Otherwise, check via an access token.
    const apiKeyHeader = req.headers.api || req.query.api || req.body.api;
    const apiKey = typeof apiKeyHeader === "string" ? apiKeyHeader.trim() : null;
    if (apiKey) {
        const apiKeyUser = await resolveAPIKey(apiKey);
        const apiUser = apiKeyUser ? await getUserDataFromDb(apiKeyUser.id) : null;

        if (!apiUser) {
            req.warnEvent("auth.invalid_api_key", "Invalid API key provided");
            throw new AuthError("Invalid API key provided.");
        }

        let user = syncUserIntoClassStateStore(apiUser);

        req.user = {
            email: apiUser.email,
            ...user,
            id: user.id || apiUser.id,
            userId: user.id || apiUser.id,
        };

        next();
        return;
    }

    const authorizationHeader = req.headers.authorization;
    const accessToken = authorizationHeader ? authorizationHeader.replace(/^Bearer\s+/i, "") : null;
    if (!accessToken) {
        req.warnEvent("auth.missing_token", "User is not authenticated: No access token or API key provided");
        throw new AuthError("User is not authenticated");
    }

    const decodedToken = verifyToken(accessToken);
    if (decodedToken.error) {
        req.warnEvent("auth.invalid_token", "Invalid access token provided", { error: decodedToken.error });
        throw new AuthError("Invalid access token provided.");
    }

    const email = decodedToken.email;
    if (!email) {
        req.warnEvent("auth.missing_email", "Invalid access token provided: Missing 'email'");
        throw new AuthError("Invalid access token provided. Missing 'email'.");
    }

    if (decodedToken.isGuest) {
        const user = classStateStore.getUser(email);
        if (!user || !user.isGuest) {
            req.warnEvent("auth.guest_not_found", "Guest session not found or expired", { email });
            throw new AuthError("User is not authenticated");
        }

        req.user = {
            email,
            ...user,
            userId: user.id,
        };

        next();
        return;
    }

    let user = classStateStore.getUser(email);
    if (!user) {
        const computedUser = await loadComputedUserByEmail(email);
        if (!computedUser) {
            req.warnEvent("auth.user_not_found", `User not found in ClassStateStore: ${email}`, { email });
            throw new AuthError("User is not authenticated");
        }
        user = syncUserIntoClassStateStore(computedUser);
    }

    // Attach user data to req.user for stateless API authentication
    req.user = {
        email: email,
        ...user,
        userId: user.id,
    };

    next();
}

// Create a function to check if the user's email is verified
/**
 * Determine whether the current user can pass email verification checks.
 *
 * @param {import("express").Request} req - req.
 * @param {import("express").Response} res - res.
 * @param {import("express").NextFunction} next - next.
 * @returns {Promise<*>}
 */
async function isVerified(req, res, next) {
    // Use req.user if available (set by isAuthenticated), otherwise decode from token
    let email = req.user?.email;
    if (!email) {
        const accessToken = req.headers.authorization ? req.headers.authorization.replace("Bearer ", "") : null;
        if (!accessToken) {
            req.warnEvent("auth.not_authenticated", "User is not authenticated: No token found");
            throw new AuthError("User is not authenticated.");
        }

        const decodedToken = verifyToken(accessToken);
        if (!decodedToken.error && decodedToken.email) {
            email = decodedToken.email;
        }
    }

    if (!email) {
        req.warnEvent("auth.not_authenticated", "User is not authenticated: Could not determine email");
        throw new AuthError("User is not authenticated.");
    }

    const user = classStateStore.getUser(email);

    // If email verification is disabled, allow access.
    if (!settings.emailEnabled) {
        next();
        return;
    }

    // Guests bypass email verification.
    if (user && user.isGuest) {
        next();
        return;
    }

    // Fast path from in-memory session state.
    if (user && user.verified) {
        next();
        return;
    }

    // Fallback to DB when in-memory state is stale or missing `verified`.
    const dbUser = await dbGet("SELECT verified FROM users WHERE email = ?", [email]);
    if (dbUser && dbUser.verified) {
        if (user) {
            classStateStore.updateUser(email, { verified: 1 });
        }
        if (req.user) {
            req.user.verified = 1;
        }
        next();
        return;
    }

    req.warnEvent("auth.not_verified", `User email is not verified: ${email}`, { email });
    throw new AuthError("User email is not verified.");
}

module.exports = {
    cleanRefreshTokens,

    // Whitelisted/Blacklisted IP addresses
    whitelistedIps,
    blacklistedIps,

    // Authentication functions
    isAuthenticated,
    isVerified,
};
