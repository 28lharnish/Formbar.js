const ValidationError = require("@errors/validation-error");
const AppError = require("@errors/app-error");

function requireQueryParam(param, name) {
    if (param === undefined || param === null) {
        throw new ValidationError(`Required query parameter '${name}' is missing.`);
    }
}

function requireParam(param, name) {
    if (param === undefined || param === null) {
        throw new ValidationError(`Required parameter '${name}' is missing.`);
    }
}

function requireBodyParam(param, name) {
    if (param === undefined || param === null) {
        throw new ValidationError(`Required body parameter '${name}' is missing.`);
    }
}

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
