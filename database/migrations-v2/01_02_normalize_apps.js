const { columns, rebuild, runStep, tableExists } = require("./00_helpers");

/**
 * Normalizes the legacy apps table when it uses the old owner column.
 *
 * @param {import("sqlite3").Database} database
 * @returns {Promise<void>}
 */
async function runMigration(database) {
    await runStep(
        database,
        "01_02_normalize_apps",
        async () => {
            if (!(await tableExists(database, "apps"))) return;
            const appColumns = await columns(database, "apps");
            if (!appColumns.includes("owner")) return;
            await rebuild(
                database,
                "apps",
                `CREATE TABLE apps__migration (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT,
                    owner_user_id INTEGER NOT NULL,
                    share_item_id INTEGER NOT NULL,
                    pool_id INTEGER NOT NULL,
                    client_secret_hash TEXT
                )`,
                `INSERT INTO apps__migration (id, name, owner_user_id, share_item_id, pool_id)
                 SELECT id, name, owner, 0, 0 FROM apps__migration_source`
            );
        },
        ["01_normalize_legacy_schema"]
    );
}

module.exports = { run: runMigration };
