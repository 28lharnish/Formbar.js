/**
 * ApiKeyCacheStore
 * In-memory cache for API key -> entity ID lookups with TTL.
 */
class ApiKeyCacheStore {
    constructor(defaultTtlMs = 10 * 60 * 1000) {
        this._cache = new Map();
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
            return undefined;
        }

        return entry.entityId;
    }

    /**
     * Cache an API key lookup result until its TTL expires.
     *
     * @param {*} apiKey - apiKey.
     * @param {*} entityId - entityId.
     * @param {*} ttlMs - ttlMs.
     * @returns {*}
     */
    set(apiKey, entityId, ttlMs = this._defaultTtlMs) {
        const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : null;
        this._cache.set(apiKey, { entityId, expiresAt });
    }

    /**
     * Remove one API key from the cache.
     *
     * @param {*} apiKey - apiKey.
     * @returns {*}
     */
    delete(apiKey) {
        this._cache.delete(apiKey);
    }

    /**
     * Clear every cached API key lookup.
     *
     * @returns {*}
     */
    clear() {
        this._cache.clear();
    }

    /**
     * Remove every cached API key associated with one entity ID.
     *
     * @param {*} entityId - entityId.
     * @returns {*}
     */
    deleteAPIKeyByEntityId(entityId) {
        for (const [apiKey, entry] of this._cache.entries()) {
            if (entry.entityId === entityId) {
                this._cache.delete(apiKey);
            }
        }
    }
}

const apiKeyCacheStore = new ApiKeyCacheStore();

module.exports = {
    ApiKeyCacheStore,
    apiKeyCacheStore,
};
