const { columns, run, runStep } = require("./00_helpers");

/**
 * Copies legacy permission values before the source columns are removed.
 *
 * @param {import("sqlite3").Database} database
 * @returns {Promise<void>}
 */
async function runMigration(database) {
    await runStep(
        database,
        "01_01_preserve_legacy_permissions",
        async () => {
            const userColumns = await columns(database, "users");
            const classUserColumns = await columns(database, "classusers");
            await run(
                database,
                `CREATE TABLE legacy_permissions (
                    user_id INTEGER NOT NULL,
                    class_id INTEGER,
                    permission INTEGER
                )`
            );
            if (userColumns.includes("permissions")) {
                await run(database, "INSERT INTO legacy_permissions (user_id, class_id, permission) SELECT id, NULL, permissions FROM users");
            }
            if (classUserColumns.includes("permissions")) {
                await run(
                    database,
                    "INSERT INTO legacy_permissions (user_id, class_id, permission) SELECT studentId, classId, permissions FROM classusers"
                );
            }
        },
        ["01_normalize_legacy_schema"]
    );
}

module.exports = { run: runMigration };
