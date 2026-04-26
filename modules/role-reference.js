/**
 * Resolve a role object's name or pass through a string role name.
 *
 * @param {*} role - role.
 * @returns {*}
 */
function getRoleName(role) {
    if (typeof role === "string") {
        return role;
    }

    if (role && typeof role === "object" && typeof role.name === "string") {
        return role.name;
    }

    return null;
}

/**
 * Resolve a numeric role ID when the input includes one.
 *
 * @param {*} role - role.
 * @returns {*}
 */
function getRoleId(role) {
    if (!role || typeof role !== "object") {
        return null;
    }

    if (typeof role.id === "number") {
        return role.id;
    }

    return null;
}

/**
 * Create a compact `{ id, name }` reference when both values exist.
 *
 * @param {*} role - role.
 * @returns {*}
 */
function buildRoleReference(role) {
    const id = getRoleId(role);
    const name = getRoleName(role);

    if (id == null || !name) {
        return null;
    }

    return { id, name };
}

/**
 * Convert a role list into compact references for serialization.
 *
 * @param {*} roles - roles.
 * @returns {*}
 */
function buildRoleReferences(roles) {
    if (!Array.isArray(roles)) {
        return [];
    }

    return roles.map((role) => buildRoleReference(role)).filter(Boolean);
}

/**
 * Extract only the role names from a role list.
 *
 * @param {*} roles - roles.
 * @returns {*}
 */
function getRoleNames(roles) {
    if (!Array.isArray(roles)) {
        return [];
    }

    return roles.map((role) => getRoleName(role)).filter(Boolean);
}

module.exports = {
    getRoleName,
    getRoleId,
    getRoleNames,
    buildRoleReference,
    buildRoleReferences,
};
