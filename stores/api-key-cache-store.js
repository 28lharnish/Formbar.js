/**
 * ApiKeyCacheStore
 * In-memory cache for API key -> email lookups with TTL.
 */
class ApiKeyCacheStore {
    constructor(defaultTtlMs = 10 * 60 * 1000) {
        this._cache = new Map();
        this._defaultTtlMs = defaultTtlMs;
    }

    /**
     * Return the cached email for an API key if it is still valid.
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

        return entry.email;
    }

    /**
     * Cache an API key lookup result until its TTL expires.
     *
     * @param {*} apiKey - apiKey.
     * @param {*} email - email.
     * @param {*} ttlMs - ttlMs.
     * @returns {*}
     */
    set(apiKey, email, ttlMs = this._defaultTtlMs) {
        const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : null;
        this._cache.set(apiKey, { email, expiresAt });
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
     * Remove every cached API key associated with one email address.
     *
     * @param {*} email - email.
     * @returns {*}
     */
    invalidateByEmail(email) {
        for (const [apiKey, entry] of this._cache.entries()) {
            if (entry.email === email) {
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
