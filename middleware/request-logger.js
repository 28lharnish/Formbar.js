const { getLogger, logEvent } = require("@modules/logger");
const crypto = require("crypto");

// Middleware to log incoming requests and their completion time

const REDACTED_QUERY_PARAMS = new Set(
    ["api", "token", "code", "accessToken", "access_token", "refreshToken", "refresh_token", "legacyToken", "client_secret"].map((param) =>
        param.toLowerCase()
    )
);

/**
 * Escape a string so it can be safely embedded in a regular expression.
 *
 * @param {*} value - value.
 * @returns {*}
 */
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const REDACTED_QUERY_PARAM_PATTERN = Array.from(REDACTED_QUERY_PARAMS).map(escapeRegExp).join("|");

/**
 * Check whether a query parameter should be masked before writing the URL to logs.
 *
 * @param {*} param - param.
 * @returns {boolean}
 */
function isRedactedQueryParam(param) {
    return REDACTED_QUERY_PARAMS.has(String(param).toLowerCase());
}

/**
 * Mask sensitive query values so request logs can keep the path without leaking secrets.
 *
 * @param {*} rawUrl - rawUrl.
 * @returns {*}
 */
function redactUrl(rawUrl) {
    try {
        const url = new URL(rawUrl, "http://local");
        for (const param of Array.from(url.searchParams.keys())) {
            if (isRedactedQueryParam(param)) {
                url.searchParams.set(param, "[REDACTED]");
            }
        }
        return `${url.pathname}${url.search}`;
    } catch {
        return String(rawUrl || "").replace(new RegExp(`([?&](?:${REDACTED_QUERY_PARAM_PATTERN})=)[^&]*`, "gi"), "$1[REDACTED]");
    }
}

/**
 * Attach request-scoped logging helpers and record the final response status and latency.
 *
 * @param {import("express").Request} req - req.
 * @param {import("express").Response} res - res.
 * @param {import("express").NextFunction} next - next.
 * @returns {Promise<*>}
 */
async function requestLogger(req, res, next) {
    // Attach a child logger to the request with relevant metadata
    const baseMeta = {
        requestId: crypto.randomUUID(),
        method: req.method,
        path: redactUrl(req.originalUrl),
        ip: req.ip,
    };

    // Add user info if available
    if (req.user && req.user.id) {
        baseMeta.userId = req.user.id;
        baseMeta.email = req.user.email;
        baseMeta.displayName = req.user.displayName;
    }

    // adds metadata to every log under this request
    const logger = await getLogger();
    req.logger = logger.child(baseMeta);

    // helpers to log events with the request's logger
    req.logEvent = logEvent.bind(null, req.logger);
    req.infoEvent = req.logEvent.bind(null, "info");
    req.warnEvent = req.logEvent.bind(null, "warn");
    req.errorEvent = req.logEvent.bind(null, "error");

    const start = process.hrtime.bigint();

    // set listener for when response finishes
    res.on("finish", () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        req.infoEvent("request.complete", "Request Complete", {
            statusCode: res.statusCode,
            duration: durationMs,
        });
    });

    next();
}

module.exports = requestLogger;
