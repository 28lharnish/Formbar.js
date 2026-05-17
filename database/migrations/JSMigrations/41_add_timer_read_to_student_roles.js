const { dbGetAll, dbRun } = require("@modules/database");
const { SCOPES } = require("@modules/permissions");
const { ROLE_NAMES } = require("@modules/roles");

function parseScopes(value) {
    if (Array.isArray(value)) {
        return value.filter((scope) => typeof scope === "string");
    }

    if (typeof value !== "string" || !value.trim()) {
        return [];
    }

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((scope) => typeof scope === "string") : [];
    } catch {
        return [];
    }
}

async function appendScopeToNamedRoles(database, roleNames, scope) {
    const placeholders = roleNames.map(() => "?").join(", ");
    const rows = await dbGetAll(`SELECT id, scopes FROM roles WHERE name IN (${placeholders})`, roleNames, database);

    for (const row of rows) {
        const scopes = parseScopes(row.scopes);
        if (scopes.includes(scope)) {
            continue;
        }

        scopes.push(scope);
        await dbRun("UPDATE roles SET scopes = ? WHERE id = ?", [JSON.stringify(scopes), row.id], database);
    }
}

module.exports = {
    async run(database) {
        await appendScopeToNamedRoles(
            database,
            [ROLE_NAMES.STUDENT, ROLE_NAMES.MOD, ROLE_NAMES.TEACHER, ROLE_NAMES.MANAGER],
            SCOPES.CLASS.TIMER.READ
        );

        console.log("Migration 41 completed: timer read scope backfilled for student-visible roles.");
    },
};
