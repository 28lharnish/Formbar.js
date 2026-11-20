const { rebuild, runStep } = require("./00_helpers");

/**
 * Rebuilds classroom with the common v3 columns.
 *
 * @param {import("sqlite3").Database} database
 * @returns {Promise<void>}
 */
async function runMigration(database) {
    await runStep(
        database,
        "01_04_normalize_classroom",
        async () => {
            await rebuild(
                database,
                "classroom",
                `CREATE TABLE classroom__migration (
                    id INTEGER NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    owner INTEGER NOT NULL,
                    key INTEGER NOT NULL,
                    tags TEXT,
                    settings TEXT,
                    PRIMARY KEY (id AUTOINCREMENT)
                )`,
                "INSERT INTO classroom__migration (id, name, owner, key, tags, settings) SELECT id, name, owner, key, tags, settings FROM classroom__migration_source"
            );
        },
        ["01_normalize_legacy_schema"]
    );
}

module.exports = { run: runMigration };
