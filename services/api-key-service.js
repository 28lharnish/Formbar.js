const { dbGet, dbGetAll, dbRun } = require("@modules/database");
const { compareBcrypt, isBcryptHash, sha256 } = require("@modules/crypto");
const { apiKeyCacheStore } = require("@stores/api-key-cache-store");
const { getUserById } = require("@services/user-service");
const { getAppById} = require("@services/app-service");

const entityResolvers = {
    "user": getUserById,
    "app": getAppById,
}

/**
 * Normalize a raw API key value from headers, query strings, or request bodies.
 * @param {unknown} apiKey - Raw API key.
 * @returns {string|null}
 */
function normalizeAPIKey(apiKey) {
    if (typeof apiKey !== "string") {
        return null;
    }

    const normalized = apiKey.trim();
    return normalized || null;
}

/**
 * Hash an API key for indexed storage and lookup.
 * @param {string} apiKey - Plaintext API key.
 * @returns {string}
 */
function hashAPIKey(apiKey) {
    return sha256(apiKey);
}

/**
 * Find an entity by API key. SHA-256 keys are resolved by direct lookup; legacy
 * bcrypt keys are checked only as a fallback and migrated after a successful match.
 * @param {string} rawAPIKey - Plaintext API key.
 * @returns {Promise<Object|null>}
 */
async function resolveAPIKey(rawAPIKey) {
    const apiKey = normalizeAPIKey(rawAPIKey);
    if (!apiKey) {
        return null;
    }

    // Check the cache for this API key before hitting the database
    const cachedEntityId = apiKeyCacheStore.get(apiKey);
    if (cachedEntityId) {
        const apiKeyHash = hashAPIKey(apiKey);
        const entity = await dbGet("SELECT entity_id, entity_type FROM api_keys WHERE api_key_hash = ?", [apiKeyHash]);
        if (entity) {
            const resolver = entityResolvers[entity.entity_type];
            if (resolver) {
                return resolver(entity.entity_id);
            }
        }
        apiKeyCacheStore.delete(apiKey);
    }

    const apiKeyHash = hashAPIKey(ApiKey);
    const shaUser = await dbGet("SELECT id, email, API FROM users WHERE API = ?", [apiKeyHash]);
    if (shaUser) {
        apiKeyCacheStore.set(apiKey, shaUser.id);
        return { ...shaUser, migrated: false };
    }

    const legacyUsers = await dbGetAll("SELECT id, email, API FROM users WHERE API IS NOT NULL AND API LIKE '$2%'");
   
    await dbRun("BEGIN TRANSACTION");
    for (const user of legacyUsers) {
        if (!isBcryptHash(user.API)) {
            continue;
        }

        const matches = await compareBcrypt(apiKey, user.API);
        if (!matches) {
            continue;
        }

        await dbRun("UPDATE users SET API = ? WHERE id = ? AND API = ?", [apiKeyHash, user.id, user.API]);
        apiKeyCacheStore.set(apiKey, user.email);
        return { ...user, API: apiKeyHash, migrated: true };
    }
    await dbRun("COMMIT");

    return null;
}

/**
 * Resolve only the email address for an API key when that is all the caller needs.
 * @param {string} apiKey - Plaintext API key.
 * @returns {Promise<string|null>}
 */
async function getEmailFromAPIKey(apiKey) {
    const user = await resolveAPIKey(apiKey);
    return user ? user.email : null;
}

module.exports = {
    normalizeAPIKey,
    hashAPIKey,
    resolveAPIKey,
    getEmailFromAPIKey,
};
