const AppError = require("@errors/app-error");
const { getLogger, logEvent } = require("@modules/logger");
const process = require("process");

/**
 * Detect malformed JSON or body-parser failures so they stay operational.
 *
 * @param {*} err - err.
 * @returns {boolean}
 */
function isRequestParseError(err) {
    return err instanceof SyntaxError && (err.status === 400 || err.statusCode === 400) && err.type === "entity.parse.failed";
}

module.exports = async (err, req, res, next) => {
    const logger = await getLogger();

    let error = err;
    let statusCode = err.statusCode || err.status || 500;

    const isAppError = err instanceof AppError;
    const isOperationalError = (isAppError && err.isOperational) || isRequestParseError(err);

    // is error a crash
    if (!isOperationalError) {
        if (req.errorEvent) {
            req.errorEvent("request.crash", error.message, error);
        } else {
            logEvent(logger, "error", "request.crash", error.message, { error });
        }

        if (process.env.NODE_ENV !== "production") {
            console.error(error);
        }

        statusCode = 500;
        error = new AppError("An unexpected error occurred.", { statusCode });

        // is error expected operational error
    } else {
        const event = err.event || (isRequestParseError(err) ? "request.parse.failed" : "request.error");
        if (req.warnEvent) {
            req.warnEvent(event, err.message, err);
        } else {
            logEvent(logger, "warn", event, err.message, { error: err });
        }
    }

    const response = {
        success: false,
        error: {
            message: error.message,
        },
    };

    res.status(statusCode).json(response);
};
