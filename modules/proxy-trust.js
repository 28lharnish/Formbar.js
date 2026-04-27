/**
 * Parse the Express trust proxy setting from an environment value.
 * Falls back when the value is absent or cannot be parsed as a finite number.
 *
 * @param {string|undefined} value - Environment variable value.
 * @param {number} fallback - Default trust proxy hop count.
 * @returns {number}
 */
function parseTrustProxySetting(value, fallback = 1) {
    if (value === undefined || value === null || String(value).trim() === "") {
        return fallback;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = { parseTrustProxySetting };
