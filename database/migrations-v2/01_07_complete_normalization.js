const { mark, runStep } = require("./00_helpers");

/**
 * Records the original aggregate migration name for compatibility with existing databases.
 *
 * @param {import("sqlite3").Database} database
 * @returns {Promise<void>}
 */
async function runMigration(database) {
    await runStep(
        database,
        "01_07_complete_normalization",
        () => mark(database, "01_normalize_legacy_schema"),
        ["01_normalize_legacy_schema"]
    );
}

module.exports = { run: runMigration };
