require("module-alias/register");

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const migrationDirectory = path.join(__dirname, "migrations-v2");
const databasePath = path.join(__dirname, "database.db");

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
 * @returns {Promise<void>}
 */
function close(database) {
    return new Promise((resolve, reject) => {
        database.close((error) => (error ? reject(error) : resolve()));
    });
}

/**
 * Runs the v2 migration chain against either a fresh init.sql database or an existing v2 database.
 *
 * @returns {Promise<void>}
 */
async function migrate() {
    if (!fs.existsSync(databasePath)) throw new Error(`Database does not exist: ${databasePath}`);

    if (!process.env.SKIP_BACKUP) {
        const backupPath = fs.existsSync(path.join(__dirname, "database.bak"))
            ? path.join(__dirname, `database-${Date.now()}.bak`)
            : path.join(__dirname, "database.bak");
        fs.copyFileSync(databasePath, backupPath);
    }

    const database = new sqlite3.Database(databasePath);
    try {
        await run(database, "PRAGMA foreign_keys = ON");
        const files = fs
            .readdirSync(migrationDirectory)
            .filter((file) => /^\d+_.+\.js$/.test(file) && file !== "00_helpers.js")
            .sort((left, right) => left.localeCompare(right));

        for (const file of files) {
            const migration = require(path.join(migrationDirectory, file));
            await migration.run(database);
            console.log(`Completed migration: ${file}`);
        }
    } finally {
        await close(database);
    }
}

migrate().catch((error) => {
    console.error("Database migration failed:", error);
    process.exitCode = 1;
});
