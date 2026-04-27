/**
 * ClassCodeCacheStore
 * In-memory cache for class code => class id lookups.
 */
class ClassCodeCacheStore {
    constructor() {
        this._cache = {};
    }

    /**
     * Look up the class ID associated with a join code.
     *
     * @param {*} code - code.
     * @returns {*}
     */
    get(code) {
        return this._cache[code];
    }

    /**
     * Cache a join code so the class can be resolved without another database lookup.
     *
     * @param {*} code - code.
     * @param {*} classId - classId.
     * @returns {*}
     */
    set(code, classId) {
        this._cache[code] = classId;
    }

    /**
     * Remove a cached join code once it is no longer valid.
     *
     * @param {*} code - code.
     * @returns {*}
     */
    delete(code) {
        delete this._cache[code];
    }

    /**
     * Clear the full join-code cache, typically during a broad reset.
     *
     * @returns {*}
     */
    clear() {
        this._cache = {};
    }

    /**
     * Drop every cached code that points at the supplied class ID.
     *
     * @param {*} classId - classId.
     * @returns {*}
     */
    invalidateByClassId(classId) {
        for (const [code, id] of Object.entries(this._cache)) {
            if (id == classId) {
                delete this._cache[code];
            }
        }
    }

    /**
     * Return the entire join-code cache for diagnostics or bulk inspection.
     *
     * @returns {*}
     */
    getAll() {
        return this._cache;
    }
}

const classCodeCacheStore = new ClassCodeCacheStore();

module.exports = {
    ClassCodeCacheStore,
    classCodeCacheStore,
};
