const { ROLES, LEVEL_TO_ROLE, DEFAULT_ROLE_COLORS } = require("../../modules/roles");
const { all, exec, mark, run, tableExists } = require("./00_helpers");

/**
 * Creates v3 roles and preserves legacy permission assignments.
 *
 * @param {import("sqlite3").Database} database
 * @returns {Promise<void>}
 */
async function runMigration(database) {
    const done = await tableExists(database, "schema_migrations_v2");
    if (done && (await all(database, "SELECT 1 FROM schema_migrations_v2 WHERE name = ?", ["02_roles_and_permissions"])).length) return;

    await run(database, "BEGIN IMMEDIATE");
    try {
        await exec(
            database,
            `CREATE TABLE IF NOT EXISTS roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                isDefault INTEGER NOT NULL DEFAULT 0,
                scopes TEXT NOT NULL DEFAULT '[]',
                color TEXT NOT NULL DEFAULT '#808080'
            );
            CREATE TABLE IF NOT EXISTS class_roles (
                roleId INTEGER NOT NULL,
                classId INTEGER NOT NULL,
                orderIndex INTEGER
            );
            CREATE TABLE IF NOT EXISTS user_roles (
                userId INTEGER NOT NULL,
                roleId INTEGER NOT NULL,
                classId INTEGER
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_class_roles_unique ON class_roles (classId, roleId);
            CREATE INDEX IF NOT EXISTS idx_class_roles_classId ON class_roles (classId);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_unique ON user_roles (userId, roleId, COALESCE(classId, -1))`
        );

        for (const [name, definition] of Object.entries(ROLES)) {
            const scopes = JSON.stringify([...new Set([...(definition.global || []), ...(definition.class || [])])]);
            await run(database, "INSERT OR IGNORE INTO roles (name, isDefault, scopes, color) VALUES (?, 1, ?, ?)", [
                name,
                scopes,
                DEFAULT_ROLE_COLORS[name] || "#808080",
            ]);
        }

        const roleRows = await all(database, "SELECT id, name FROM roles");
        const roleIds = new Map(roleRows.map((row) => [row.name, row.id]));
        if (await tableExists(database, "legacy_permissions")) {
            const permissions = await all(database, "SELECT user_id, class_id, permission FROM legacy_permissions");
            for (const row of permissions) {
                const roleId = roleIds.get(LEVEL_TO_ROLE[row.permission] || "Guest");
                await run(database, "INSERT OR IGNORE INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [
                    row.user_id,
                    roleId,
                    row.class_id,
                ]);
            }
        }

        const classrooms = await all(database, "SELECT id FROM classroom");
        for (const classroom of classrooms) {
            for (const roleId of roleIds.values()) {
                await run(database, "INSERT OR IGNORE INTO class_roles (roleId, classId) VALUES (?, ?)", [roleId, classroom.id]);
            }
        }

        await run(database, "DROP TABLE IF EXISTS legacy_permissions");
        await mark(database, "02_roles_and_permissions");
        await run(database, "COMMIT");
    } catch (error) {
        await run(database, "ROLLBACK").catch(() => undefined);
        throw error;
    }
}

module.exports = { run: runMigration };
