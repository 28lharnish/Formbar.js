/**
 * ApiKeyCacheStore
 * In-memory cache for API key -> entity ID lookups with TTL.
 */
class ApiKeyCacheStore {
    constructor(defaultTtlMs = 10 * 60 * 1000) {
        this._cache = new Map(); // by api key
        this._entityMap = new Map(); // by entity id
        this._defaultTtlMs = defaultTtlMs;
    }

    /**
     * Return the cached entity ID for an API key if it is still valid.
     *
     * @param {*} apiKey - apiKey.
     * @returns {*}
     */
    get(apiKey) {
        const entry = this._cache.get(apiKey);
        if (!entry) return undefined;

        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            this._cache.delete(apiKey);
            this._entityMap.delete(`${entry.entityType}:${entry.entityId}`);
            return undefined;
        }

        return { type: entry.entityType, id: entry.entityId };
    }

    /**
     * Cache an API key lookup result until its TTL expires.
     *
     * @param {*} apiKey - apiKey.
     * @param {*} entityId - entityId.
     * @param {*} entityType - entityType.
     * @param {*} ttlMs - ttlMs.
     * @returns {*}
     */
    set(apiKey, entityId, entityType, ttlMs = this._defaultTtlMs) {
        const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : null;
        const cacheEntry = { entityId, entityType, expiresAt };
        this._cache.set(apiKey, cacheEntry);

        const entityKey = `${entityType}:${entityId}`;
        this._entityMap.set(entityKey, {
            apiKey: apiKey,
        });
    }

    /**
     * Remove one API key from the cache.
     *
     * @param {*} apiKey - apiKey.
     * @returns {*}
     */
    invalidateByAPIKey(apiKey) {
        const entry = this._cache.get(apiKey);
        if (!entry) return;
        this._entityMap.delete(`${entry.entityType}:${entry.entityId}`);
        this._cache.delete(apiKey);
    }

    /**
     * Clear every cached API key lookup.
     *
     * @returns {*}
     */
    clear() {
        this._cache.clear();
        this._entityMap.clear();
    }

    /**
     * Remove every cached API key associated with one entity ID.
     *
     * @param {*} entityId - entityId.
     * @param {*} entityType - entityType.
     * @returns {*}
     */
    invalidateByEntity(entityId, entityType) {
        const entityKey = `${entityType}:${entityId}`;
        if (this._entityMap.has(entityKey)) {
            const apiKey = this._entityMap.get(entityKey).apiKey;
            this._cache.delete(apiKey);
            this._entityMap.delete(entityKey);
        }
    }
}

const apiKeyCacheStore = new ApiKeyCacheStore();

module.exports = {
    ApiKeyCacheStore,
    apiKeyCacheStore,
};
