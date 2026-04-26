const { getUserDataFromDb } = require("@services/user-service");
const { resolveAPIKey } = require("@services/api-key-service");
const { dbGet } = require("@modules/database");
const { verifyToken } = require("@services/auth-service");
const { settings } = require("@modules/config");
const { computeGlobalPermissionLevel, STUDENT_PERMISSIONS, TEACHER_PERMISSIONS } = require("@modules/permissions");
const { getUserScopes } = require("@modules/scope-resolver");

// In-memory rate limit storage
// Structure: { identifier: { path: [timestamps], hasBeenMessaged: bool } }
const rateLimits = {};

const TIMED_RATE_LIMIT_WINDOW_MS = 60000;
const UNAUTHENTICATED_USER_RATE_LIMIT = 25;
const AUTHENTICATED_USER_RATE_LIMIT = 120;
const AUTHENTICATED_USER_RATE_LIMIT_FOR_AUTH_PATHS = 25;
const TEACHER_RATE_LIMIT = 225;
const GLOBAL_BUCKET_MULTIPLIER = 4;
const MAX_PATH_BUCKETS_PER_IDENTITY = 250;

/**
 * Strip the bearer prefix from an Authorization header before token validation.
 *
 * @param {*} value - value.
 * @returns {*}
 */
function getBearerToken(value) {
    return typeof value === "string" ? value.replace(/^Bearer\s+/i, "") : null;
}

/**
 * Collapse variable path segments so similar routes share a stable rate-limit bucket.
 *
 * @param {*} path - path.
 * @returns {*}
 */
function normalizeRateLimitPath(path) {
    return String(path || "/")
        .split("/")
        .map((segment) => {
            if (!segment) return segment;
            if (/^\d+$/.test(segment)) return ":id";
            if (/^[0-9a-f-]{16,}$/i.test(segment)) return ":token";
            if (segment.length > 24) return ":value";
            return segment;
        })
        .join("/");
}

/**
 * Detect auth routes that should use the stricter login and token exchange limits.
 *
 * @param {*} path - path.
 * @returns {boolean}
 */
function isAuthPath(path) {
    return /(?:^|\/)auth(?:\/|$)/.test(path);
}

/**
 * Pick a non-critical bucket to evict when one identity has too many tracked paths.
 *
 * @param {*} userRequests - userRequests.
 * @param {*} path - path.
 * @param {*} globalPath - globalPath.
 * @returns {*}
 */
function getBucketKeyToEvict(userRequests, path, globalPath) {
    return Object.keys(userRequests).find((key) => key !== path && key !== globalPath && key !== "hasBeenMessaged");
}

/**
 * Resolve a stable identity from the request so API keys, JWTs, and IPs share consistent limits.
 *
 * @param {import("express").Request} req - req.
 * @returns {Promise<*>}
 */
async function resolveRateLimitIdentity(req) {
    const fallbackIdentity = `ip:${req.ip || "unknown"}`;

    const apiKeyHeader = req.headers.api;
    const apiKey = typeof apiKeyHeader === "string" ? apiKeyHeader.trim() : null;
    if (apiKey) {
        const apiKeyUser = await resolveAPIKey(apiKey);
        if (apiKeyUser?.id) {
            const userData = await getUserDataFromDb(apiKeyUser.id);
            if (userData?.id) {
                return { identifier: `user:${userData.id}`, user: userData };
            }
        }
        return { identifier: fallbackIdentity, user: null };
    }

    const authorizationHeader = req.headers.authorization;
    if (authorizationHeader) {
        const decodedToken = verifyToken(getBearerToken(authorizationHeader));
        if (decodedToken && !decodedToken.error && decodedToken.email) {
            const userRow = await dbGet("SELECT id FROM users WHERE email = ?", [decodedToken.email]);
            if (userRow?.id) {
                const userData = await getUserDataFromDb(userRow.id);
                if (userData?.id) {
                    return { identifier: `user:${userData.id}`, user: userData };
                }
            }
        }
    }

    return { identifier: fallbackIdentity, user: null };
}

/**
 * Enforce per-identity request caps and fail fast with 429 before the handlers do extra work.
 *
 * @param {import("express").Request} req - req.
 * @param {import("express").Response} res - res.
 * @param {import("express").NextFunction} next - next.
 * @returns {Promise<*>}
 */
async function rateLimiter(req, res, next) {
    const { identifier, user } = await resolveRateLimitIdentity(req);
    const currentTime = Date.now();
    const timeFrame = settings.rateLimitWindowMs ?? TIMED_RATE_LIMIT_WINDOW_MS;
    const permissionLevel = user ? computeGlobalPermissionLevel(getUserScopes(user).global) : 0;

    let maximumRequests = UNAUTHENTICATED_USER_RATE_LIMIT; // Default limit for unauthenticated users
    if (permissionLevel >= TEACHER_PERMISSIONS) {
        maximumRequests = TEACHER_RATE_LIMIT;
    } else if (permissionLevel >= STUDENT_PERMISSIONS) {
        maximumRequests = isAuthPath(req.path) ? AUTHENTICATED_USER_RATE_LIMIT_FOR_AUTH_PATHS : AUTHENTICATED_USER_RATE_LIMIT;
    }

    // Apply the configurable multiplier so test runs can relax limits.
    maximumRequests = Math.max(1, Math.round(maximumRequests * (settings.rateLimitMultiplier ?? 1)));

    // Initialize rate limit log for the user if it doesn't exist
    if (!rateLimits[identifier]) {
        rateLimits[identifier] = {};
    }

    // Get the user's request log
    const userRequests = rateLimits[identifier];
    const path = normalizeRateLimitPath(req.path);
    const globalPath = "__global__";

    // Initialize request array for this path if it doesn't exist
    if (!userRequests[path]) {
        userRequests[path] = [];
    }
    if (!userRequests[globalPath]) {
        userRequests[globalPath] = [];
    }

    const bucketKeys = Object.keys(userRequests).filter((key) => key !== "hasBeenMessaged");
    if (bucketKeys.length > MAX_PATH_BUCKETS_PER_IDENTITY) {
        const keyToEvict = getBucketKeyToEvict(userRequests, path, globalPath);
        if (keyToEvict) {
            delete userRequests[keyToEvict];
        }
    }

    // Remove timestamps that are outside the time frame
    for (const key of [path, globalPath]) {
        while (userRequests[key].length && currentTime - userRequests[key][0] > timeFrame) {
            userRequests[key].shift();
            userRequests["hasBeenMessaged"] = false;
        }
    }

    // Check if the user has exceeded the limit
    // If they have, send a rate limit response
    // Otherwise, log the request and proceed
    if (userRequests[path].length >= maximumRequests || userRequests[globalPath].length >= maximumRequests * GLOBAL_BUCKET_MULTIPLIER) {
        if (!userRequests["hasBeenMessaged"]) {
            userRequests["hasBeenMessaged"] = true;
            req.warnEvent("rate_limit.exceeded", `Rate limit exceeded for user ${identifier} on path ${path}`, {
                identifier,
                path,
                limit: maximumRequests,
                permissionLevel,
            });
        }

        // Always respond while over-limit; otherwise the request hangs forever.
        return res.status(429).json({ error: `You are being rate limited. Please try again in ${timeFrame / 1000} seconds.` });
    }

    userRequests[path].push(currentTime);
    userRequests[globalPath].push(currentTime);
    next();
}

module.exports = {
    rateLimiter,
    getBucketKeyToEvict,
};
