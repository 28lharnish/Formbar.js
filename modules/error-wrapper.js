const ValidationError = require("@errors/validation-error");
const AppError = require("@errors/app-error");

/**
 * Requires a query parameter to be present.
 *
 * @param {*} param - param.
 * @param {*} name - name.
 * @returns {*}
 */
function requireQueryParam(param, name) {
    if (param === undefined || param === null) {
        throw new ValidationError(`Required query parameter '${name}' is missing.`);
    }
}

/**
 * Requires a url parameter to be present
 *
 * @param {*} param - param.
 * @param {*} name - name.
 * @returns {*}
 */
function requireParam(param, name) {
    if (param === undefined || param === null) {
        throw new ValidationError(`Required parameter '${name}' is missing.`);
    }
}

/**
 * Requires a body parameter to be present.
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
 * Requires a param to be provided internally, primarily used for services.
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
    requireParam,
    requireBodyParam,
    requireInternalParam,
};
