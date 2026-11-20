/**
 * Retains the original migration filename for databases that already recorded it.
 * New databases apply the smaller ordered steps in this directory before migration 02.
 *
 * @param {import("sqlite3").Database} database
 * @returns {Promise<void>}
 */
async function runMigration(database) {
    void database;
}

module.exports = { run: runMigration };
