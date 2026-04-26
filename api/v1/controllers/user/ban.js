const { hasScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { dbGet, dbRun } = require("@modules/database");
const { SCOPES, BANNED_PERMISSIONS, STUDENT_PERMISSIONS } = require("@modules/permissions");
const { managerUpdate } = require("@services/socket-updates-service");
const { findRoleByPermissionLevel } = require("@services/role-service");
const NotFoundError = require("@errors/not-found-error");

/**
 * Register ban controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/ban:
     *   patch:
     *     summary: Ban a user globally
     *     tags:
     *       - Users
     *     description: Globally bans a user by assigning them the Banned role. Requires manager permissions.
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         description: The ID of the user to ban
     *         schema:
     *           type: string
     *           example: "1"
     *     responses:
     *       200:
     *         description: User banned successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ok:
     *                   type: boolean
     *       404:
     *         description: User not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.patch("/user/:id/ban", isAuthenticated, hasScope(SCOPES.GLOBAL.USERS.MANAGE), async (req, res) => {
        const userId = req.params.id;
        req.infoEvent("user.ban.attempt", "Attempting to ban user");

        const user = await dbGet(`SELECT * FROM users WHERE id = ?`, [userId]);
        if (!user) {
            throw new NotFoundError("User not found", { event: "user.ban.failed", reason: "user_not_found" });
        }

        // Remove all global roles and assign the Banned role
        await dbRun("DELETE FROM user_roles WHERE userId = ? AND classId IS NULL", [userId]);
        const bannedRole = await findRoleByPermissionLevel(BANNED_PERMISSIONS, null);
        if (bannedRole) {
            await dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, NULL)", [userId, bannedRole.id]);
        }

        await managerUpdate();

        req.infoEvent("user.ban.success", "User banned successfully", {});
        res.status(200).json({
            success: true,
            data: {
                ok: true,
            },
        });
    });

    /**
     * @swagger
     * /api/v1/user/{id}/unban:
     *   patch:
     *     summary: Unban a user globally
     *     tags:
     *       - Users
     *     description: Globally unbans a user by restoring their Student role. Requires manager permissions.
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         description: The ID of the user to unban
     *         schema:
     *           type: string
     *           example: "1"
     *     responses:
     *       200:
     *         description: User unbanned successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ok:
     *                   type: boolean
     *       404:
     *         description: User not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.patch("/user/:id/unban", isAuthenticated, hasScope(SCOPES.GLOBAL.USERS.MANAGE), async (req, res) => {
        const userId = req.params.id;
        req.infoEvent("user.unban.attempt", "Attempting to unban user");

        const user = await dbGet(`SELECT * FROM users WHERE id = ?`, [userId]);
        if (!user) {
            throw new NotFoundError("User not found", { event: "user.unban.failed", reason: "user_not_found" });
        }

        // Remove Banned role and assign Student role
        await dbRun("DELETE FROM user_roles WHERE userId = ? AND classId IS NULL", [userId]);
        const studentRole = await findRoleByPermissionLevel(STUDENT_PERMISSIONS, null);
        if (studentRole) {
            await dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, NULL)", [userId, studentRole.id]);
        }

        await managerUpdate();

        req.infoEvent("user.unban.success", "User unbanned successfully", {});
        res.status(200).json({
            success: true,
            data: {
                ok: true,
            },
        });
    });
};
