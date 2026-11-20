const sqlite3 = require("sqlite3").verbose();

/**
 * @param {sqlite3.Database} database
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<void>}
 */
function run(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.run(sql, params, (error) => (error ? reject(error) : resolve()));
    });
}

/**
 * @param {sqlite3.Database} database
 * @param {string} sql
 * @returns {Promise<void>}
 */
function exec(database, sql) {
    return new Promise((resolve, reject) => {
        database.exec(sql, (error) => (error ? reject(error) : resolve()));
    });
}

/**
 * @param {sqlite3.Database} database
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<Record<string, unknown>[]>}
 */
function all(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
    });
}

/**
 * @param {sqlite3.Database} database
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<Record<string, unknown>|undefined>}
 */
function get(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.get(sql, params, (error, row) => (error ? reject(error) : resolve(row)));
    });
}

/**
 * @param {sqlite3.Database} database
 * @param {string} table
 * @returns {Promise<boolean>}
 */
async function tableExists(database, table) {
    return Boolean(await get(database, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [table]));
}

/**
 * @param {sqlite3.Database} database
 * @param {string} table
 * @returns {Promise<string[]>}
 */
async function columns(database, table) {
    const rows = await all(database, `PRAGMA table_info("${table}")`);
    return rows.map((row) => String(row.name));
}

/**
 * @param {sqlite3.Database} database
 * @param {string} table
 * @param {string} createSql
 * @param {string} insertSql
 * @param {unknown[][]} [rows]
 * @returns {Promise<void>}
 */
async function rebuild(database, table, createSql, insertSql, rows) {
    const source = `${table}__migration_source`;
    await run(database, `DROP TABLE IF EXISTS "${source}"`);
    await run(database, `ALTER TABLE "${table}" RENAME TO "${source}"`);
    await run(database, createSql);
    if (rows) {
        for (const row of rows) await run(database, insertSql, row);
    } else {
        await run(database, insertSql);
    }
    await run(database, `DROP TABLE "${source}"`);
    await run(database, `ALTER TABLE "${table}__migration" RENAME TO "${table}"`);
}

/**
 * @param {sqlite3.Database} database
 * @param {string} name
 * @returns {Promise<void>}
 */
async function mark(database, name) {
    await run(database, "CREATE TABLE IF NOT EXISTS schema_migrations_v2 (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    await run(database, "INSERT OR IGNORE INTO schema_migrations_v2 (name, applied_at) VALUES (?, datetime('now'))", [name]);
}

/**
 * Runs and records one atomic migration step.
 *
 * @param {sqlite3.Database} database
 * @param {string} name
 * @param {() => Promise<void>} work
 * @param {string[]} [compatibleNames]
 * @returns {Promise<void>}
 */
async function runStep(database, name, work, compatibleNames = []) {
    if (await tableExists(database, "schema_migrations_v2")) {
        const names = [name, ...compatibleNames];
        const applied = await all(
            database,
            `SELECT name FROM schema_migrations_v2 WHERE name IN (${names.map(() => "?").join(", ")})`,
            names
        );
        if (applied.length) return;
    }

    await run(database, "BEGIN IMMEDIATE");
    try {
        await work();
        await mark(database, name);
        await run(database, "COMMIT");
    } catch (error) {
        await run(database, "ROLLBACK").catch(() => undefined);
        throw error;
    }
}

module.exports = { all, columns, exec, get, mark, rebuild, run, runStep, tableExists };
