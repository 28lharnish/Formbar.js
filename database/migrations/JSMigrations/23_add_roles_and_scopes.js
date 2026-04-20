// 23_add_roles_and_scopes.js
// Adds the roles/user_roles tables and role columns to users/classusers.
// Idempotent: safe to run multiple times on the same database.

const { dbRun, dbGetAll } = require("@modules/database");
const { ROLES, ROLE_NAMES } = require("@modules/roles");

/**
 * Builds the seed scopes JSON string for a role by combining its global and class scopes.
 * Deduplicates entries via Set.
 */
function buildScopesJson(roleName) {
    const roleDefinition = ROLES[roleName];
    if (!roleDefinition) return "[]";
    const allScopes = [...new Set([...roleDefinition.global, ...roleDefinition.class])];
    return JSON.stringify(allScopes);
}

module.exports = {
    async run(database) {
        // Create roles table if it doesn't exist
        await dbRun(
            `CREATE TABLE IF NOT EXISTS "roles" (
                "id"      INTEGER NOT NULL UNIQUE,
                "name"    TEXT NOT NULL,
                "isDefault" INTEGER NOT NULL DEFAULT 0,
                "scopes"  TEXT NOT NULL DEFAULT '[]',
                PRIMARY KEY ("id" AUTOINCREMENT)
            )`,
            [],
            database
        );

        // Create user_roles table if it doesn't exist
        await dbRun(
            `CREATE TABLE IF NOT EXISTS "user_roles" (
                "userId"  INTEGER NOT NULL,
                "roleId"  INTEGER NOT NULL,
                "classId" INTEGER
            )`,
            [],
            database
        );

        // Create class_roles table if it doesn't exist
        await dbRun(
            `CREATE TABLE IF NOT EXISTS "class_roles" (
            "roleId" INTEGER NOT NULL,
            "classId" INTEGER NOT NULL
            )`,
            [],
            database
        );

        // Create index on classId for faster queries
        await dbRun(`CREATE INDEX IF NOT EXISTS "idx_class_roles_classId" ON "class_roles" ("classId")`, [], database);

        await dbRun(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_class_roles_unique" ON "class_roles" ("classId", "roleId")`, [], database);

        // Create unique index for user_roles (handles NULL classId)
        try {
            await dbRun(
                `CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_roles_unique" ON "user_roles" ("userId", "roleId", COALESCE("classId", -1))`,
                [],
                database
            );
        } catch (e) {
            // Index may already exist
        }

        // Seed default global roles (upsert-safe via checking existence)
        const existingRoles = await dbGetAll(
            `SELECT name
             FROM roles
                         WHERE isDefault = 1`,
            [],
            database
        );
        const existingNames = new Set(existingRoles.map((r) => r.name));

        const defaultRoles = Object.values(ROLE_NAMES).map((name) => ({
            name,
            scopes: buildScopesJson(name),
        }));

        for (const role of defaultRoles) {
            if (!existingNames.has(role.name)) {
                await dbRun(`INSERT INTO "roles" ("name", "scopes", "isDefault") VALUES (?, ?, ?)`, [role.name, role.scopes, 1], database);
            }
        }

        // Backfill legacy classrooms once so pre-role classes gain class-scoped
        // copies of the built-in defaults. Runtime reads should not create these.
        await dbRun(
            `INSERT OR IGNORE INTO class_roles (roleId, classId)
             SELECT r.id, c.id
             FROM classroom c
             JOIN roles r ON r.isDefault = 1
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM class_roles cr
                 WHERE cr.classId = c.id
             )`,
            [],
            database
        );

        // Add/backfill the legacy users.role column only while permissions still exist.
        // Once migration 25 has removed permissions, re-adding role would just recreate
        // a transient column on every migrate run.
        const usersColumns = await dbGetAll("PRAGMA table_info(users)", [], database);
        const usersHasRole = usersColumns.some((col) => col.name === "role");
        const usersHasPermissions = usersColumns.some((col) => col.name === "permissions");

        if (usersHasPermissions) {
            if (!usersHasRole) {
                await dbRun(`ALTER TABLE "users" ADD COLUMN "role" TEXT`, [], database);
            }

            // Backfill users.role from existing numeric permissions without clobbering
            // rows that already have a role value.
            await dbRun(`UPDATE "users" SET "role" = 'Banned' WHERE "permissions" = 0 AND ("role" IS NULL OR "role" = '')`, [], database);
            await dbRun(`UPDATE "users" SET "role" = 'Guest' WHERE "permissions" = 1 AND ("role" IS NULL OR "role" = '')`, [], database);
            await dbRun(`UPDATE "users" SET "role" = 'Student' WHERE "permissions" = 2 AND ("role" IS NULL OR "role" = '')`, [], database);
            await dbRun(`UPDATE "users" SET "role" = 'Mod' WHERE "permissions" = 3 AND ("role" IS NULL OR "role" = '')`, [], database);
            await dbRun(`UPDATE "users" SET "role" = 'Teacher' WHERE "permissions" = 4 AND ("role" IS NULL OR "role" = '')`, [], database);
            await dbRun(`UPDATE "users" SET "role" = 'Manager' WHERE "permissions" = 5 AND ("role" IS NULL OR "role" = '')`, [], database);
        }

        // Add/backfill the legacy classusers.role column only while permissions still exist.
        const classusersColumns = await dbGetAll("PRAGMA table_info(classusers)", [], database);
        const classusersHasRole = classusersColumns.some((col) => col.name === "role");
        const classusersHasPermissions = classusersColumns.some((col) => col.name === "permissions");

        if (classusersHasPermissions) {
            if (!classusersHasRole) {
                await dbRun(`ALTER TABLE "classusers" ADD COLUMN "role" TEXT`, [], database);
            }

            // Backfill classusers.role from existing numeric permissions without
            // overwriting rows that were already migrated.
            await dbRun(`UPDATE "classusers" SET "role" = 'Banned' WHERE "permissions" = 0 AND ("role" IS NULL OR "role" = '')`, [], database);
            await dbRun(`UPDATE "classusers" SET "role" = 'Guest' WHERE "permissions" = 1 AND ("role" IS NULL OR "role" = '')`, [], database);
            await dbRun(`UPDATE "classusers" SET "role" = 'Student' WHERE "permissions" = 2 AND ("role" IS NULL OR "role" = '')`, [], database);
            await dbRun(`UPDATE "classusers" SET "role" = 'Mod' WHERE "permissions" = 3 AND ("role" IS NULL OR "role" = '')`, [], database);
            await dbRun(`UPDATE "classusers" SET "role" = 'Teacher' WHERE "permissions" = 4 AND ("role" IS NULL OR "role" = '')`, [], database);
            await dbRun(`UPDATE "classusers" SET "role" = 'Manager' WHERE "permissions" = 5 AND ("role" IS NULL OR "role" = '')`, [], database);
        }

        console.log("Migration 23 completed: roles tables ensured and legacy role columns backfilled when available.");
    },
};
