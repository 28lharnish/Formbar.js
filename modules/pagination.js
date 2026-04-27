const ValidationError = require("@errors/validation-error");

/**
 * Parse an integer query parameter.
 * @param {string|number|undefined} value - Query value.
 * @param {number} defaultValue - Default value.
 * @returns {number}
 */
function parseIntegerQueryParam(value, defaultValue) {
    if (value == null) {
        return defaultValue;
    }

    const normalized = String(value).trim();
    if (!/^-?\d+$/.test(normalized)) {
        return NaN;
    }

    return Number.parseInt(normalized, 10);
}

/**
 * Parse and validate limit/offset pagination parameters.
 * @param {Object} query - Query object.
 * @param {number} defaultLimit - Default limit value.
 * @param {number} maxLimit - Maximum allowed limit value.
 * @param {number} [minLimit=1] - Minimum allowed limit value.
 * @returns {{limit: number, offset: number}}
 */
function parsePaginationQuery(query, defaultLimit, maxLimit, minLimit = 1) {
    const limit = parseIntegerQueryParam(query?.limit, defaultLimit);
    const offset = parseIntegerQueryParam(query?.offset, 0);

    if (!Number.isInteger(limit) || limit < minLimit || limit > maxLimit) {
        throw new ValidationError(`Invalid limit. Expected an integer between ${minLimit} and ${maxLimit}.`);
    }

    if (!Number.isInteger(offset) || offset < 0) {
        throw new ValidationError("Invalid offset. Expected a non-negative integer.");
    }

    return { limit, offset };
}

/**
 * Build the standardized pagination response object.
 * @param {number} total - Total matching records.
 * @param {number} limit - Page size.
 * @param {number} offset - Offset into the result set.
 * @param {number} returnedCount - Number of records returned in the current page.
 * @returns {{total: number, limit: number, offset: number, hasMore: boolean}}
 */
function buildPagination(total, limit, offset, returnedCount) {
    return {
        total,
        limit,
        offset,
        hasMore: offset + returnedCount < total,
    };
}

module.exports = {
    buildPagination,
    parseIntegerQueryParam,
    parsePaginationQuery,
};
