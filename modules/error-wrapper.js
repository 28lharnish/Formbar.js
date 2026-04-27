const ValidationError = require("@errors/validation-error");
const AppError = require("@errors/app-error");

/**
 * Require Query Param.
 *
 * @param {*} param - param.
 * @param {*} name - name.
 * @returns {*}
 */
function requireQueryParam(param, name) {
    if (param === undefined || param === null || Number.isNaN(param)) {
        throw new ValidationError(`Required query parameter '${name}' is missing.`);
    }
}

/**
 * Require Body Param.
 *
 * @param {*} param - param.
 * @param {*} name - name.
 * @returns {*}
 */
function requireBodyParam(param, name) {
    if (param === undefined || param === null) {
        throw new ValidationError(`Required body parameter '${name}' is missing.`);
    }
}

/**
 * Require Internal Param.
 *
 * @param {*} param - param.
 * @param {*} name - name.
 * @returns {*}
 */
function requireInternalParam(param, name) {
    if (param === undefined || param === null) {
        throw new AppError(`Internal Error: Missing required parameter '${name}'.`, { statusCode: 500 });
    }
}

module.exports = {
    requireQueryParam,
    requireBodyParam,
    requireInternalParam,
};
