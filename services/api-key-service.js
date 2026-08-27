const { dbGet, dbRun } = require("@modules/database");
const { sha256 } = require("@modules/crypto");
const { requireInternalParam } = require("@modules/error-wrapper");
const { apiKeyCacheStore } = require("@stores/api-key-cache-store");
const { getUserDataFromDb } = require("@services/user-service");
const { randomBytes } = require("crypto");
const NotFoundError = require("@errors/not-found-error");
const ValidationError = require("@errors/validation-error");

// maps entity types to functions that can resolve them by ID
const entityResolvers = {
    user: getUserDataFromDb,
};

// Lazy load app resolver to avoid circular dependency
Object.defineProperty(entityResolvers, "app", {
    get() {
        const { getAppById } = require("@services/app-service");
        return getAppById;
    },
    configurable: true,
});

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
async function regenerateAPIKey(entityType, entityId) {
    requireInternalParam(entityId, "entityId");
    requireInternalParam(entityType, "entityType");

    const resolver = entityResolvers[entityType];
    if (!resolver) {
        throw new ValidationError(`Invalid entity type for API key regeneration: ${entityType}`, {
            event: `api_key.regenerate.failed`,
            reason: `invalid_entity_type`,
        });
    }

    const entity = await resolver(entityId);
    if (!entity) {
        throw new NotFoundError(`${entityType.charAt(0).toUpperCase() + entityType.slice(1)} not found for API key regeneration.`, {
            event: `${entityType}.api_key.regenerate.failed`,
            reason: `${entityType}_not_found`,
        });
    }

    const existingAPIKey = await dbGet("SELECT api_key_hash FROM api_keys WHERE entity_id = ? AND entity_type = ?", [entityId, entityType]);
    const apiKey = randomBytes(32).toString("hex");
    const hashedAPIKey = hashAPIKey(apiKey);
    if (existingAPIKey) {
        await dbRun("UPDATE api_keys SET api_key_hash = ?, created_at = CURRENT_TIMESTAMP WHERE entity_id = ? AND entity_type = ?", [
            hashedAPIKey,
            entityId,
            entityType,
        ]);
    } else {
        await dbRun("INSERT INTO api_keys (api_key_hash, entity_id, entity_type) VALUES (?, ?, ?)", [hashedAPIKey, entityId, entityType]);
    }

    apiKeyCacheStore.invalidateByEntity(entityId, entityType);
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

    const apiKeyHash = hashAPIKey(apiKey);

    // Check the cache for this API key before hitting the database
    const cachedEntity = apiKeyCacheStore.get(apiKey);
    if (cachedEntity) {
        const shaEntity = await dbGet("SELECT entity_id, entity_type FROM api_keys WHERE api_key_hash = ?", [apiKeyHash]);

        if (!shaEntity || shaEntity.entity_id !== cachedEntity.id || shaEntity.entity_type !== cachedEntity.type) {
            apiKeyCacheStore.invalidateByAPIKey(apiKey);
        } else {
            const resolver = entityResolvers[cachedEntity.type];
            if (!resolver) {
                return null;
            }

            const resolvedEntity = await resolver(cachedEntity.id);
            if (!resolvedEntity) {
                return null;
            }

            return { ...resolvedEntity, cached: true, migrated: false };
        }
    }

    const shaEntity = await dbGet("SELECT * FROM api_keys WHERE api_key_hash = ?", [apiKeyHash]);
    if (shaEntity) {
        const resolver = entityResolvers[shaEntity.entity_type];
        if (!resolver) {
            return null;
        }

        const resolvedEntity = await resolver(shaEntity.entity_id);
        if (!resolvedEntity) {
            return null;
        }

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
