const { columns, rebuild, runStep } = require("./00_helpers");

/**
 * Rebuilds classusers without legacy permission columns.
 *
 * @param {import("sqlite3").Database} database
 * @returns {Promise<void>}
 */
async function runMigration(database) {
    await runStep(
        database,
        "01_05_normalize_classusers",
        async () => {
            const classUserColumns = await columns(database, "classusers");
            await rebuild(
                database,
                "classusers",
                `CREATE TABLE classusers__migration (
                    classId INTEGER NOT NULL,
                    studentId INTEGER NOT NULL,
                    digiPogs INTEGER
                )`,
                `INSERT INTO classusers__migration (classId, studentId, digiPogs)
                 SELECT classId, studentId, ${classUserColumns.includes("digiPogs") ? "digiPogs" : "0"}
                 FROM classusers__migration_source`
            );
        },
        ["01_normalize_legacy_schema"]
    );
}

module.exports = { run: runMigration };
