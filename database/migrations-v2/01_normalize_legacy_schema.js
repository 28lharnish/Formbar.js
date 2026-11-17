const { all, columns, exec, mark, rebuild, run, tableExists } = require("./00_helpers");

/**
 * Normalizes the two supported starting schemas into the common v3 baseline.
 *
 * @param {import("sqlite3").Database} database
 * @returns {Promise<void>}
 */
async function runMigration(database) {
    if (
        (await tableExists(database, "schema_migrations_v2")) &&
        (await all(database, "SELECT 1 FROM schema_migrations_v2 WHERE name = ?", ["01_normalize_legacy_schema"])).length
    ) {
        return;
    }
    await run(database, "BEGIN IMMEDIATE");
    try {
        const userColumns = await columns(database, "users");
        const classUserColumns = await columns(database, "classusers");
        const apiColumn = userColumns.includes("API") ? "API" : "NULL";
        const pinColumn = userColumns.includes("pin") ? "pin" : "NULL";
        await exec(
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

        if (await tableExists(database, "apps")) {
            const appColumns = await columns(database, "apps");
            if (appColumns.includes("owner")) {
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
            }
        }

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

        if (await tableExists(database, "class_permissions")) await run(database, "DROP TABLE class_permissions");
        if (await tableExists(database, "digipog_pool_users")) await run(database, "DROP TABLE digipog_pool_users");
        await mark(database, "01_normalize_legacy_schema");
        await run(database, "COMMIT");
    } catch (error) {
        await run(database, "ROLLBACK").catch(() => undefined);
        throw error;
    }
}

module.exports = { run: runMigration };
