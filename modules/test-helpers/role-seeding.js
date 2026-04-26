const { LEVEL_TO_ROLE, ROLE_NAMES } = require("@modules/roles");

/**
 * Look up the role row used to seed permissions consistently.
 *
 * @param {*} mockDatabase - mockDatabase.
 * @param {*} roleName - roleName.
 * @param {*} classId - classId.
 * @returns {Promise<*>}
 */
async function getRoleRow(mockDatabase, roleName, classId = null) {
    if (classId == null) {
        return mockDatabase.dbGet(
            `SELECT r.id, r.name, r.scopes, r.color
             FROM roles r
             WHERE r.name = ?
                             AND r.isDefault = 1`,
            [roleName]
        );
    }
    return mockDatabase.dbGet(
        `SELECT r.id, r.name, r.scopes, r.color
         FROM roles r
         JOIN class_roles cr ON cr.roleId = r.id
         WHERE r.name = ? AND cr.classId = ?`,
        [roleName, classId]
    );
}

/**
 * Replace a user's global role assignment with the matching permission level.
 *
 * @param {*} mockDatabase - mockDatabase.
 * @param {*} userId - userId.
 * @param {*} permissionLevel - permissionLevel.
 * @returns {Promise<*>}
 */
async function setGlobalPermissionLevel(mockDatabase, userId, permissionLevel) {
    const roleName = LEVEL_TO_ROLE[permissionLevel];
    await mockDatabase.dbRun("DELETE FROM user_roles WHERE userId = ? AND classId IS NULL", [userId]);

    if (!roleName) {
        return null;
    }

    const role = await getRoleRow(mockDatabase, roleName, null);
    if (!role) {
        return null;
    }

    await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, NULL)", [userId, role.id]);
    return role.name;
}

/**
 * Ensure a user belongs to the class and assign the requested class permission.
 *
 * @param {*} mockDatabase - mockDatabase.
 * @param {*} userId - userId.
 * @param {*} classId - classId.
 * @param {*} permissionLevel - permissionLevel.
 * @param {*} options - options.
 * @returns {Promise<*>}
 */
async function addClassMemberWithPermission(mockDatabase, userId, classId, permissionLevel, options = {}) {
    const existing = await mockDatabase.dbGet("SELECT 1 FROM classusers WHERE classId = ? AND studentId = ?", [classId, userId]);
    if (!existing) {
        await mockDatabase.dbRun("INSERT INTO classusers (classId, studentId, digiPogs) VALUES (?, ?, ?)", [
            classId,
            userId,
            options.digiPogs ?? null,
        ]);
    }

    await mockDatabase.dbRun("DELETE FROM user_roles WHERE userId = ? AND classId = ?", [userId, classId]);

    const roleName = LEVEL_TO_ROLE[permissionLevel];
    if (!roleName || roleName === ROLE_NAMES.GUEST) {
        return roleName || null;
    }

    let role = await getRoleRow(mockDatabase, roleName, classId);
    if (!role) {
        const globalRole = await getRoleRow(mockDatabase, roleName, null);
        if (globalRole) {
            await mockDatabase.dbRun("INSERT OR IGNORE INTO class_roles (roleId, classId) VALUES (?, ?)", [globalRole.id, classId]);
            role = await getRoleRow(mockDatabase, roleName, classId);
        }
    }
    if (role) {
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [userId, role.id, classId]);
    }

    return roleName;
}

module.exports = {
    getRoleRow,
    setGlobalPermissionLevel,
    addClassMemberWithPermission,
};
