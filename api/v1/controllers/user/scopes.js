const { isAuthenticated } = require("@middleware/authentication");
const { isSelfOrHasScope } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const { classStateStore } = require("@services/classroom-service");
const { getUserDataFromDb } = require("@services/user-service");
const { getUserScopes, getUserRoleName } = require("@modules/scope-resolver");
const { getUserRoles } = require("@services/role-service");
const NotFoundError = require("@errors/not-found-error");

/**
 * * Register scopes controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/scopes:
     *   get:
     *     summary: Get resolved scopes and role for a user
     *     tags:
     *       - Users
     *     description: |
     *       Returns the user's resolved role name, global scopes, and (if the user is
     *       in an active class) their class roles and class scopes. Only accessible by
     *       the user themselves or a manager.
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         description: The ID of the user to retrieve scopes for
     *         schema:
     *           type: string
     *           example: "1"
     *     responses:
     *       200:
     *         description: User scopes returned successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 data:
     *                   type: object
     *                   properties:
     *                     role:
     *                       type: string
     *                       example: "Student"
     *                     roles:
     *                       type: object
     *                       properties:
     *                         global:
     *                           type: array
     *                         class:
     *                           type: array
     *                     scopes:
     *                       type: object
     *                       properties:
     *                         global:
     *                           type: array
     *                           items:
     *                             type: string
     *                         class:
     *                           type: array
     *                           items:
     *                             type: string
     *       401:
     *         description: Unauthorized
     *       403:
     *         description: Forbidden - not the user themselves or a manager
     *       404:
     *         description: User not found
     */
    router.get(
        "/user/:id/scopes",
        isAuthenticated,
        isSelfOrHasScope(SCOPES.GLOBAL.USERS.MANAGE, "You do not have permission to view this user's scopes."),
        async (req, res) => {
            const userId = Number(req.params.id);

            const userData = await getUserDataFromDb(userId);
            if (!userData) {
                throw new NotFoundError("User not found.");
            }

            const role = getUserRoleName(userData);
            const rolesFromDb = await getUserRoles(userData.id);
            let roles = { ...rolesFromDb };
            const scopes = getUserScopes(userData);

            const result = {
                role,
                roles,
                scopes,
            };

            const liveUser = classStateStore.getUser(userData.email);
            if (liveUser && liveUser.activeClass) {
                const classroom = classStateStore.getClassroom(liveUser.activeClass);
                const classStudent = classroom?.students?.[userData.email];
                if (classStudent) {
                    roles = { global: rolesFromDb.global, class: classStudent.roles?.class || [] };
                    const resolved = getUserScopes(classStudent, classroom);
                    result.roles = roles;
                    result.scopes = { global: scopes.global, class: resolved.class };
                }
            }

            res.status(200).json({
                success: true,
                data: result,
            });
        }
    );
};
