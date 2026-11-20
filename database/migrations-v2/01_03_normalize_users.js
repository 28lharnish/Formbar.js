const { columns, rebuild, run, runStep } = require("./00_helpers");

/**
 * Rebuilds users with the common v3 columns and constraints.
 *
 * @param {import("sqlite3").Database} database
 * @returns {Promise<void>}
 */
async function runMigration(database) {
    await runStep(
        database,
        "01_03_normalize_users",
        async () => {
            const userColumns = await columns(database, "users");
            const apiColumn = userColumns.includes("API") ? "API" : "NULL";
            const pinColumn = userColumns.includes("pin") ? "pin" : "NULL";
            await rebuild(
                database,
                "users",
                `CREATE TABLE users__migration (
                    id INTEGER NOT NULL UNIQUE,
                    email TEXT NOT NULL UNIQUE,
                    password TEXT,
                    API TEXT UNIQUE,
                    secret TEXT NOT NULL UNIQUE,
                    digipogs INTEGER NOT NULL DEFAULT 0,
                    pin TEXT,
                    displayName TEXT,
                    verified INTEGER NOT NULL DEFAULT 0,
                    pog_meter INTEGER NOT NULL DEFAULT 0 CHECK (pog_meter >= 0),
                    PRIMARY KEY (id AUTOINCREMENT)
                )`,
                `INSERT INTO users__migration
                    (id, email, password, API, secret, digipogs, pin, displayName, verified, pog_meter)
                 SELECT id, email, password, ${apiColumn}, secret, COALESCE(digipogs, 0), ${pinColumn}, displayName,
                        COALESCE(verified, 0), 0
                 FROM users__migration_source`
            );
            await run(database, "CREATE UNIQUE INDEX IF NOT EXISTS idx_display_name_unique ON users (displayName)");
        },
        ["01_normalize_legacy_schema"]
    );
}

module.exports = { run: runMigration };
