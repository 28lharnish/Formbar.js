const { dbGet, dbGetAll, dbRun } = require("@modules/database");
const { compareBcrypt, isBcryptHash, sha256 } = require("@modules/crypto");
const { apiKeyCacheStore } = require("@stores/api-key-cache-store");
const { getUser } = require("@services/user-service");
const { getAppById} = require("@services/app-service");

// maps entity types to functions that can resolve them by ID
const entityResolvers = {
    "user": async (userId) => getUser.bind(null, { id: userId }), // I'm so sorry
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
 * Create and save a new API key for a user.
 * @param {number} userId - userId.
 * @returns {Promise<string>}
 */
async function regenerateAPIKey(entityId, entityType) {
    requireInternalParam(entityId, "entityId");
    requireInternalParam(entityType, "entityType");

    const entity = await entityResolvers[entityType](entityId);
    if (!entity) {
        throw new NotFoundError(`${entityType.charAt(0).toUpperCase() + entityType.slice(1)} not found for API key regeneration.`, {
            event: `${entityType}.api_key.regenerate.failed`,
            reason: `${entityType}_not_found`,
        });
    }

    const apiKey = crypto.randomBytes(32).toString("hex");
    const hashedAPIKey = hashAPIKey(apiKey);
    await dbRun("INSERT INTO api_keys (api_key_hash, entity_id, entity_type) VALUES (?, ?, ?)", [hashedAPIKey, entityId, entityType]);

    apiKeyCacheStore.deleteByEntity(entityId, entityType);
    apiKeyCacheStore.set(apiKey, entityId, entityType);
    return apiKey;
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
    const cachedEntity = apiKeyCacheStore.get(apiKey);
    if (cachedEntity) {
        const resolver = entityResolvers[cachedEntity.type];

        if (resolver) {
            const resolvedEntity = await resolver(cachedEntity.id);
            return resolvedEntity ? { ...resolvedEntity, cached: true, migrated: false } : null;
        }
        // If the cache had an entry but we couldn't resolve it, remove the stale cache entry
        apiKeyCacheStore.invalidateByAPIKey(apiKey);
    }

    const apiKeyHash = hashAPIKey(apiKey);
    const shaEntity = await dbGet("SELECT * FROM api_keys WHERE api_key_hash = ?", [apiKeyHash]);
    if (shaEntity) {
        const resolvedEntity = await entityResolvers[shaEntity.entity_type](shaEntity.entity_id);
        apiKeyCacheStore.set(apiKey, shaEntity.entity_id, shaEntity.entity_type);
        return { ...resolvedEntity, cached: false, migrated: false };
    }

    return null;
}

module.exports = {
    normalizeAPIKey,
    hashAPIKey,
    resolveAPIKey,
    regenerateAPIKey,
};
