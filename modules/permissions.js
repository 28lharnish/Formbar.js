const { ROLE_TO_LEVEL, ROLE_NAMES, ROLES } = require("@modules/roles");
const { SCOPES, SOCKET_EVENT_SCOPE_MAP } = require("@modules/scopes");
const { getRoleId, getRoleName } = require("@modules/role-reference");

const BANNED_PERMISSIONS = ROLE_TO_LEVEL[ROLE_NAMES.BANNED];
const GUEST_PERMISSIONS = ROLE_TO_LEVEL[ROLE_NAMES.GUEST];
const STUDENT_PERMISSIONS = ROLE_TO_LEVEL[ROLE_NAMES.STUDENT];
const MOD_PERMISSIONS = ROLE_TO_LEVEL[ROLE_NAMES.MOD];
const TEACHER_PERMISSIONS = ROLE_TO_LEVEL[ROLE_NAMES.TEACHER];
const MANAGER_PERMISSIONS = ROLE_TO_LEVEL[ROLE_NAMES.MANAGER];

const GLOBAL_STUDENT_SCOPES = [SCOPES.GLOBAL.POOLS.MANAGE, SCOPES.GLOBAL.DIGIPOGS.TRANSFER];
const GLOBAL_MOD_SCOPES = [SCOPES.GLOBAL.SYSTEM.MODERATE];
const GLOBAL_TEACHER_SCOPES = [SCOPES.GLOBAL.CLASS.CREATE, SCOPES.GLOBAL.CLASS.DELETE, SCOPES.GLOBAL.DIGIPOGS.AWARD];
const GLOBAL_MANAGER_SCOPES = [SCOPES.GLOBAL.SYSTEM.ADMIN, SCOPES.GLOBAL.USERS.MANAGE];
const GLOBAL_BLOCKED_SCOPES = [SCOPES.GLOBAL.SYSTEM.BLOCKED];

const CLASS_STUDENT_SCOPES = [SCOPES.CLASS.POLL.VOTE, SCOPES.CLASS.BREAK.REQUEST, SCOPES.CLASS.HELP.REQUEST];
const CLASS_MOD_SCOPES = [
    SCOPES.CLASS.POLL.CREATE,
    SCOPES.CLASS.POLL.END,
    SCOPES.CLASS.POLL.DELETE,
    SCOPES.CLASS.POLL.SHARE,
    SCOPES.CLASS.BREAK.APPROVE,
    SCOPES.CLASS.HELP.APPROVE,
    SCOPES.CLASS.AUXILIARY.CONTROL,
    SCOPES.CLASS.GAMES.ACCESS,
    SCOPES.CLASS.TAGS.MANAGE,
    SCOPES.CLASS.LINKS.MANAGE,
];
const CLASS_TEACHER_SCOPES = [
    SCOPES.CLASS.STUDENTS.READ,
    SCOPES.CLASS.STUDENTS.KICK,
    SCOPES.CLASS.STUDENTS.BAN,
    SCOPES.CLASS.STUDENTS.PERM_CHANGE,
    SCOPES.CLASS.SESSION.START,
    SCOPES.CLASS.SESSION.END,
    SCOPES.CLASS.SESSION.RENAME,
    SCOPES.CLASS.SESSION.SETTINGS,
    SCOPES.CLASS.SESSION.REGENERATE_CODE,
    SCOPES.CLASS.TIMER.CONTROL,
    SCOPES.CLASS.DIGIPOGS.AWARD,
];
const CLASS_MANAGER_SCOPES = [SCOPES.CLASS.SYSTEM.ADMIN];
const CLASS_BLOCKED_SCOPES = [SCOPES.CLASS.SYSTEM.BLOCKED];

function parseScopesField(value) {
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

function filterScopesByDomain(value, domain) {
    const prefix = domain === "global" ? "global." : "class.";
    return parseScopesField(value).filter((scope) => typeof scope === "string" && scope.startsWith(prefix));
}

function hasAnyScope(scopeSet, candidateScopes) {
    return candidateScopes.some((scope) => scopeSet.has(scope));
}

/**
 * Normalizes mixed permission inputs into a unique array of scope strings.
 * Entries may already be scope keys, or may be role-like values that need to be
 * expanded via {@link getScopesFromRoleLike} for the requested domain.
 *
 * @param {Array<string|number|object>} input
 * @param {{domain?: "global"|"class", availableRoles?: Array<{id: number|string, scopes?: string[]|string}>}} [options={}]
 * @returns {string[]}
 */
function normalizeScopes(input, options = {}) {
    if (!Array.isArray(input) || input.length === 0) {
        return [];
    }

    const domain = options.domain === "global" ? "global" : "class";
    const prefix = `${domain}.`;
    const scopes = new Set();

    for (const entry of input) {
        if (typeof entry === "string" && entry.includes(".")) {
            if (entry.startsWith(prefix)) {
                scopes.add(entry);
            }
            continue;
        }

        const entryScopes = getScopesFromRoleLike(entry, domain, options);
        for (const scope of entryScopes) {
            scopes.add(scope);
        }
    }

    return [...scopes];
}

function getScopesFromRoleLike(roleLike, domain, options = {}) {
    if (!roleLike) {
        return [];
    }

    if (roleLike && typeof roleLike === "object" && Object.prototype.hasOwnProperty.call(roleLike, "scopes")) {
        return filterScopesByDomain(roleLike.scopes, domain);
    }

    const roleId = getRoleId(roleLike);
    if (roleId != null && Array.isArray(options.availableRoles)) {
        const availableRole = options.availableRoles.find((role) => Number(role.id) === Number(roleId));
        if (availableRole) {
            return filterScopesByDomain(availableRole.scopes, domain);
        }
    }

    const roleName = getRoleName(roleLike);
    if (roleName && ROLES[roleName]) {
        return [...(ROLES[roleName][domain] || [])];
    }

    return [];
}

function hasGlobalAdminScope(globalScopes) {
    const scopeSet = new Set(normalizeScopes(globalScopes, { domain: "global" }));
    return hasAnyScope(scopeSet, GLOBAL_MANAGER_SCOPES);
}

function computeGlobalPermissionLevel(globalScopes) {
    const scopeSet = new Set(normalizeScopes(globalScopes, { domain: "global" }));

    if (hasAnyScope(scopeSet, GLOBAL_BLOCKED_SCOPES)) {
        return BANNED_PERMISSIONS;
    }

    if (hasAnyScope(scopeSet, GLOBAL_MANAGER_SCOPES)) {
        return MANAGER_PERMISSIONS;
    }

    if (hasAnyScope(scopeSet, GLOBAL_TEACHER_SCOPES)) {
        return TEACHER_PERMISSIONS;
    }

    if (hasAnyScope(scopeSet, GLOBAL_MOD_SCOPES)) {
        return MOD_PERMISSIONS;
    }

    if (hasAnyScope(scopeSet, GLOBAL_STUDENT_SCOPES)) {
        return STUDENT_PERMISSIONS;
    }

    return GUEST_PERMISSIONS;
}

function computeClassPermissionLevel(classScopes, options = {}) {
    const scopeSet = new Set(normalizeScopes(classScopes, { domain: "class" }));
    const hasOwnerBypass = Boolean(options.isOwner);

    if (hasAnyScope(scopeSet, CLASS_BLOCKED_SCOPES) && !hasOwnerBypass && !hasAnyScope(scopeSet, CLASS_MANAGER_SCOPES)) {
        return BANNED_PERMISSIONS;
    }

    if (hasOwnerBypass || hasAnyScope(scopeSet, CLASS_MANAGER_SCOPES)) {
        return MANAGER_PERMISSIONS;
    }

    if (hasAnyScope(scopeSet, CLASS_TEACHER_SCOPES)) {
        return TEACHER_PERMISSIONS;
    }

    if (hasAnyScope(scopeSet, CLASS_MOD_SCOPES)) {
        return MOD_PERMISSIONS;
    }

    if (hasAnyScope(scopeSet, CLASS_STUDENT_SCOPES)) {
        return STUDENT_PERMISSIONS;
    }

    return GUEST_PERMISSIONS;
}

function hasGlobalPermissionLevel(globalScopes, minimumLevel) {
    return computeGlobalPermissionLevel(globalScopes) >= minimumLevel;
}

function hasClassPermissionLevel(classScopes, minimumLevel, options = {}) {
    return computeClassPermissionLevel(classScopes, options) >= minimumLevel;
}

function computePermissionLevel(input, options = {}) {
    const domain = options.domain === "global" ? "global" : "class";
    const scopes = normalizeScopes(input, options);
    return domain === "global" ? computeGlobalPermissionLevel(scopes) : computeClassPermissionLevel(scopes, options);
}

module.exports = {
    SCOPES,
    SOCKET_EVENT_SCOPE_MAP,
    normalizeScopes,
    parseScopesField,
    filterScopesByDomain,
    getScopesFromRoleLike,
    hasGlobalAdminScope,
    computePermissionLevel,
    computeGlobalPermissionLevel,
    computeClassPermissionLevel,
    hasGlobalPermissionLevel,
    hasClassPermissionLevel,
    hasAnyScope,
    BANNED_PERMISSIONS,
    GUEST_PERMISSIONS,
    STUDENT_PERMISSIONS,
    MOD_PERMISSIONS,
    TEACHER_PERMISSIONS,
    MANAGER_PERMISSIONS,
};
