const { ROLE_NAMES, LEVEL_TO_ROLE, ROLE_TO_LEVEL } = require("@modules/roles");
const {
    SCOPES,
    CLASS_STUDENT_SCOPES,
    CLASS_MOD_SCOPES,
    CLASS_TEACHER_SCOPES,
    computeGlobalPermissionLevel,
    getScopesFromRoleLike,
    hasGlobalAdminScope,
    filterScopesByDomain,
} = require("@modules/permissions");
const { getRoleName, getRoleNames } = require("@modules/role-reference");
const AppError = require("@errors/app-error");
const { flattenObject } = require("@modules/util");

/**
 * Filters a resolved scope array down to unique string scope keys.
 * Used after scope-resolver has already expanded roles, overrides, and direct scope arrays.
 *
 * @param {Array<unknown>} scopes
 * @returns {string[]}
 */
function dedupeScopes(scopes) {
    return [...new Set(scopes.filter((scope) => typeof scope === "string"))];
}

function getGlobalRoleEntries(user) {
    if (!user) {
        return [];
    }

    if (
        user.roles &&
        typeof user.roles === "object" &&
        !Array.isArray(user.roles) &&
        Array.isArray(user.roles.global) &&
        user.roles.global.length > 0
    ) {
        return user.roles.global;
    }

    if (Array.isArray(user.roles) && user.roles.length > 0) {
        return user.roles;
    }

    if (user.role) {
        return [user.role];
    }

    return [];
}

function getClassRoleEntries(classUser) {
    if (!classUser) {
        return [];
    }

    if (
        classUser.roles &&
        typeof classUser.roles === "object" &&
        !Array.isArray(classUser.roles) &&
        Array.isArray(classUser.roles.class) &&
        classUser.roles.class.length > 0
    ) {
        return classUser.roles.class;
    }

    return [];
}

function isClassOwner(classUser, classroom) {
    if (!classUser || !classroom) {
        return Boolean(classUser && classUser.isClassOwner);
    }

    return (
        classUser.isClassOwner === true ||
        (classUser.id != null && Number(classroom.owner) === Number(classUser.id)) ||
        (classUser.email && String(classroom.owner) === String(classUser.email))
    );
}

function getGlobalScopesForRole(role) {
    return getScopesFromRoleLike(role, "global");
}

function getClassScopesForRole(role, classroom) {
    const roleId = role && typeof role === "object" ? role.id : null;
    const roleName = getRoleName(role);
    if (roleName && classroom?.roleOverrides?.[roleName]) {
        return dedupeScopes(classroom.roleOverrides[roleName]);
    }
    if (roleId != null && classroom?.customRoles?.[roleId]) {
        return dedupeScopes(classroom.customRoles[roleId]);
    }
    if (roleName && classroom?.customRoles?.[roleName]) {
        return dedupeScopes(classroom.customRoles[roleName]);
    }

    const scopes = getScopesFromRoleLike(role, "class", {
        availableRoles: Array.isArray(classroom?.availableRoles) ? classroom.availableRoles : [],
    });

    if (scopes.length > 0) {
        return scopes;
    }

    return scopes;
}

function getUserScopes(user, classroom) {
    if (!user) {
        throw new AppError("No user defined");
    }

    const scopes = {
        global: [],
        class: [],
    };

    // If the user has explicit scopes.global / scopes.class arrays, use those directly (after deduping and checking for admin/block scopes).
    // Otherwise, resolve scopes from roles as normal.
    const explicitGlobal =
        user.scopes && typeof user.scopes === "object" && !Array.isArray(user.scopes) && Array.isArray(user.scopes.global)
            ? user.scopes.global
            : null;
    const rawGlobalScopes = Array.isArray(explicitGlobal)
        ? filterScopesByDomain(explicitGlobal, "global")
        : getGlobalRoleEntries(user)
              .map((role) => getGlobalScopesForRole(role))
              .flat();

    const globalScopes = dedupeScopes(rawGlobalScopes);
    const isGlobalAdmin = hasGlobalAdminScope(globalScopes);
    const isGlobalBanned = globalScopes.includes(SCOPES.GLOBAL.SYSTEM.BLOCKED);
    scopes.global = isGlobalAdmin ? getAllGlobalScopes() : isGlobalBanned ? [] : globalScopes;

    const explicitClass =
        user.scopes && typeof user.scopes === "object" && !Array.isArray(user.scopes) && Array.isArray(user.scopes.class) ? user.scopes.class : null;
    const rawClassScopes = Array.isArray(explicitClass)
        ? filterScopesByDomain(explicitClass, "class")
        : getClassRoleEntries(user)
              .map((role) => getClassScopesForRole(role, classroom))
              .flat();

    const classScopes = dedupeScopes(rawClassScopes);
    const isClassAdmin = classScopes.includes(SCOPES.CLASS.SYSTEM.ADMIN);
    const isClassBanned = classScopes.includes(SCOPES.CLASS.SYSTEM.BLOCKED);
    const ownerBypass = isClassOwner(user, classroom);
    scopes.class = ownerBypass || isClassAdmin ? getAllClassScopes() : isClassBanned ? [] : classScopes;

    return scopes;
}

function getAssignedClassScopes(user, classroom) {
    if (!user) {
        return [];
    }

    const explicitClass =
        user.scopes && typeof user.scopes === "object" && !Array.isArray(user.scopes) && Array.isArray(user.scopes.class) ? user.scopes.class : null;
    const rawClassScopes = Array.isArray(explicitClass)
        ? filterScopesByDomain(explicitClass, "class")
        : getClassRoleEntries(user)
              .map((role) => getClassScopesForRole(role, classroom))
              .flat();

    return dedupeScopes(rawClassScopes);
}

function userHasAnyScope(user, scopes, classroom = null) {
    if (!user || !Array.isArray(scopes) || scopes.length === 0) {
        return false;
    }

    return scopes.some((scope) => userHasScope(user, scope, classroom));
}

function getClassAccessProfile(classUser, classroom) {
    const assignedClassScopes = getAssignedClassScopes(classUser, classroom);
    const isOwner = isClassOwner(classUser, classroom);
    const isManager = isOwner || assignedClassScopes.includes(SCOPES.CLASS.SYSTEM.ADMIN);
    const isBlocked = assignedClassScopes.includes(SCOPES.CLASS.SYSTEM.BLOCKED) && !isManager;
    const isTeacher = !isManager && !isBlocked && assignedClassScopes.some((scope) => CLASS_TEACHER_SCOPES.includes(scope));
    const isMod = !isManager && !isBlocked && !isTeacher && assignedClassScopes.some((scope) => CLASS_MOD_SCOPES.includes(scope));
    const isStudent = !isManager && !isBlocked && !isTeacher && !isMod && assignedClassScopes.some((scope) => CLASS_STUDENT_SCOPES.includes(scope));

    let category = "guest";
    if (isBlocked) {
        category = "banned";
    } else if (isManager) {
        category = "manager";
    } else if (isTeacher) {
        category = "teacher";
    } else if (isMod) {
        category = "mod";
    } else if (isStudent) {
        category = "student";
    }

    return {
        assignedClassScopes,
        isOwner,
        isManager,
        isBlocked,
        isTeacher,
        isMod,
        isStudent,
        category,
    };
}

function getGlobalPermissionLevelForUser(user) {
    if (!user) {
        return computeGlobalPermissionLevel([]);
    }

    return computeGlobalPermissionLevel(getUserScopes(user).global);
}

function getClassPermissionLevelForUser(classUser, classroom) {
    const profile = getClassAccessProfile(classUser, classroom);
    switch (profile.category) {
        case "banned":
            return ROLE_TO_LEVEL[ROLE_NAMES.BANNED];
        case "manager":
            return ROLE_TO_LEVEL[ROLE_NAMES.MANAGER];
        case "teacher":
            return ROLE_TO_LEVEL[ROLE_NAMES.TEACHER];
        case "mod":
            return ROLE_TO_LEVEL[ROLE_NAMES.MOD];
        case "student":
            return ROLE_TO_LEVEL[ROLE_NAMES.STUDENT];
        default:
            return ROLE_TO_LEVEL[ROLE_NAMES.GUEST];
    }
}

function userHasScope(user, scope, classroom = null) {
    if (!user) return false;

    const userScopes = getUserScopes(user, classroom);
    if (hasGlobalAdminScope(userScopes.global)) {
        return true;
    }
    if (userScopes.class.includes(SCOPES.CLASS.SYSTEM.ADMIN) && typeof scope === "string" && scope.startsWith("class.")) {
        return true;
    }

    const scopes = userScopes.global.concat(userScopes.class);
    return scopes.includes(scope);
}

function selectHighestRoleName(roles, domain, options = {}) {
    let highestName = null;
    let highestLevel = -1;

    for (const role of roles) {
        const roleName = getRoleName(role);
        if (!roleName) {
            continue;
        }

        const scopes = domain === "global" ? getGlobalScopesForRole(role) : getClassScopesForRole(role, options.classroom);
        const level =
            domain === "global"
                ? computeGlobalPermissionLevel(scopes)
                : getClassPermissionLevelForUser(
                      {
                          roles: { global: [], class: [{ scopes }] },
                          isClassOwner: false,
                      },
                      options.classroom
                  );

        if (level > highestLevel) {
            highestName = roleName;
            highestLevel = level;
        }
    }

    return highestName;
}

function getUserRoleName(user) {
    if (!user) {
        return ROLE_NAMES.GUEST;
    }

    const roles = getGlobalRoleEntries(user);
    if (roles.length > 0) {
        return selectHighestRoleName(roles, "global") || getRoleName(roles[0]) || ROLE_NAMES.GUEST;
    }

    if (user.role && typeof user.role === "string") {
        return user.role;
    }

    if (typeof user.permissions === "number" && Number.isInteger(user.permissions)) {
        return LEVEL_TO_ROLE[user.permissions] || ROLE_NAMES.GUEST;
    }

    const permissionLevel = computeGlobalPermissionLevel(getUserScopes(user).global);
    return LEVEL_TO_ROLE[permissionLevel] || ROLE_NAMES.GUEST;
}

function getAllGlobalScopes() {
    let scopes = flattenObject(SCOPES.GLOBAL);
    scopes = scopes.filter((scope) => scope !== SCOPES.GLOBAL.SYSTEM.BLOCKED);
    return scopes;
}

function getAllClassScopes() {
    let scopes = flattenObject(SCOPES.CLASS);
    scopes = scopes.filter((scopes) => scopes !== SCOPES.CLASS.SYSTEM.BLOCKED);
    return scopes;
}

module.exports = {
    getUserScopes,
    getAssignedClassScopes,
    getClassAccessProfile,
    getGlobalPermissionLevelForUser,
    getClassPermissionLevelForUser,
    userHasScope,
    userHasAnyScope,
    getUserRoleName,
    isClassOwner,
    getAllClassScopes,
};
