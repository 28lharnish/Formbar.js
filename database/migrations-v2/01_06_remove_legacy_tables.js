const { run, runStep, tableExists } = require("./00_helpers");

/**
 * Drops tables that are superseded by the normalized role and pool schema.
 *
 * @param {import("sqlite3").Database} database
 * @returns {Promise<void>}
 */
async function runMigration(database) {
    await runStep(
        database,
        "01_06_remove_legacy_tables",
        async () => {
            if (await tableExists(database, "class_permissions")) await run(database, "DROP TABLE class_permissions");
            if (await tableExists(database, "digipog_pool_users")) await run(database, "DROP TABLE digipog_pool_users");
        },
        ["01_normalize_legacy_schema"]
    );
}

module.exports = { run: runMigration };
