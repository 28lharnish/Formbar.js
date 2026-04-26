const fs = require("fs").promises;
const path = require("path");
const logDir = "logs/";
const AppError = require("@errors/app-error");
const NotFoundError = require("@errors/not-found-error");

/**
 * Get available log files and contents.
 * @returns {Promise<Object[]>}
 */
async function getAllLogs() {
    try {
        const files = await fs.readdir(logDir);
        const logs = await Promise.all(
            files
                .filter((fileName) => fileName.endsWith(".log"))
                .map(async (fileName) => {
                    try {
                        const stat = await fs.stat(`${logDir}${fileName}`);
                        return stat.size > 0 ? fileName : null; // Exclude empty log files
                    } catch (e) {
                        return null;
                    }
                })
        );
        return logs.filter(Boolean); // Remove null values
    } catch (err) {
        throw new AppError(`Failed to retrieve logs: ${err.message}`, { statusCode: 500, event: "logs.get.failed", reason: "read_directory_error" });
    }
}

/**
 * Read a log file by name.
 * @param {string} logFileName - logFileName.
 * @returns {Promise<string>}
 */
async function getLog(logFileName) {
    try {
        const safeName = path.basename(String(logFileName || ""));
        if (safeName !== logFileName || !safeName.endsWith(".log")) {
            throw new NotFoundError("Log file not found", { event: "logs.get.failed", reason: "invalid_log_name" });
        }

        const content = await fs.readFile(`${logDir}${safeName}`, "utf8");
        return content;
    } catch (err) {
        if (err instanceof NotFoundError) throw err;
        if (err?.code === "ENOENT" || err?.code === "ENOTDIR") {
            throw new NotFoundError("Log file not found", { event: "logs.get.failed", reason: "log_not_found" });
        }
        throw new AppError(`Failed to read log file ${logFileName}: ${err.message}`, {
            statusCode: 500,
            event: "logs.get.failed",
            reason: "read_file_error",
        });
    }
}

module.exports = {
    getAllLogs,
    getLog,
};
