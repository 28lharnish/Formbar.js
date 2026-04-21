const { isAuthenticated } = require("@middleware/authentication");
const { dbGet } = require("@modules/database");
const { classStateStore } = require("@services/classroom-service");
const { getUserScopes } = require("@modules/scope-resolver");
const { getUserRoles } = require("@services/role-service");
const { computeGlobalPermissionLevel, computeClassPermissionLevel } = require("@modules/permissions");

/**
 * * Register me controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/me:
     *   get:
     *     summary: Get current user information
     *     tags:
     *       - Users
     *     description: |
     *       Returns information about the currently authenticated user, including
     *       their resolved global/class scopes and roles.
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     responses:
     *       200:
     *         description: Current user information returned successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/User'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.get("/user/me", isAuthenticated, async (req, res) => {
        req.infoEvent("user.me.view", "Fetching user information");

        const digipogs = req.user.digipogs ?? (await dbGet("SELECT digipogs FROM users WHERE id = ?", [req.user.id]))?.digipogs ?? 0;

        const rolesFromDb = await getUserRoles(req.user.id);
        let roles = { ...rolesFromDb };
        let scopes = getUserScopes(req.user);
        let classPermissions = null;

        const liveUser = classStateStore.getUser(req.user.email);
        if (liveUser && liveUser.activeClass) {
            const activeClassroom = classStateStore.getClassroom(liveUser.activeClass);
            const classStudent = activeClassroom?.students?.[req.user.email];
            const classroomOwnerId =
                activeClassroom?.owner || (await dbGet("SELECT owner FROM classroom WHERE id = ?", [liveUser.activeClass]))?.owner;
            const effectiveClassUser = classStudent
                ? {
                      ...classStudent,
                      isClassOwner: classStudent.isClassOwner === true || req.user.id === classroomOwnerId,
                  }
                : req.user.id === classroomOwnerId
                  ? { id: req.user.id, email: req.user.email, roles: { global: req.user.roles?.global || [], class: [] }, isClassOwner: true }
                  : null;

            if (classStudent) {
                roles = { global: rolesFromDb.global, class: classStudent.roles?.class || [] };
            }

            if (effectiveClassUser && activeClassroom) {
                const resolved = getUserScopes(effectiveClassUser, activeClassroom);
                scopes = { global: resolved.global, class: resolved.class };
                classPermissions = computeClassPermissionLevel(scopes.class, {
                    isOwner: Boolean(effectiveClassUser.isClassOwner),
                    globalScopes: resolved.global,
                });
            }
        }

        res.status(200).json({
            success: true,
            data: {
                id: req.user.id,
                email: req.user.email,
                isGuest: Boolean(req.user.isGuest),
                activeClass: req.user.activeClass,
                digipogs: digipogs,
                pogMeter: req.user.pogMeter,
                displayName: req.user.displayName,
                permissions: computeGlobalPermissionLevel(scopes.global),
                classPermissions,
                classId: req.user.classId,
                roles,
                scopes,
            },
        });
    });
};
