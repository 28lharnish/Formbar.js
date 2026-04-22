const { classStateStore } = require("@services/classroom-service");
const { getEmailFromId } = require("@services/student-service");
const { dbRun } = require("@modules/database");
const { SCOPES } = require("@modules/permissions");
const { hasScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam, requireBodyParam } = require("@modules/error-wrapper");
const { findRoleByPermissionLevel } = require("@services/role-service");
const ValidationError = require("@errors/validation-error");

/**
 * * Register perm controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/perm:
     *   patch:
     *     summary: Change user's global role by permission level
     *     tags:
     *       - Users
     *     description: Updates a user's global role by numeric permission level for backward compatibility (requires manager permissions)
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: number
     *         description: User id
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - perm
     *             properties:
     *               perm:
     *                 type: integer
     *                 example: 3
     *                 description: New permission level (0=Banned, 1=Guest, 2=Student, 3=Mod, 4=Teacher, 5=Manager)
     *     responses:
     *       200:
     *         description: Permissions updated successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ok:
     *                   type: boolean
     *                   example: true
     *       400:
     *         description: Invalid permission value
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.patch("/user/:id/perm", isAuthenticated, hasScope(SCOPES.GLOBAL.USERS.MANAGE), async (req, res) => {
        const id = Number(req.params.id);
        let { perm } = req.body || {};

        requireQueryParam(id, "id");
        if (!Number.isInteger(id) || id <= 0) {
            throw new ValidationError("Invalid user id");
        }
        requireBodyParam(perm, "perm");

        req.infoEvent("user.permissions.update.attempt", "Attempting to update user permissions", { targetUserId: id });

        perm = Number(perm);
        if (!Number.isInteger(perm) || perm < 0 || perm > 5) {
            throw new ValidationError("Invalid permission value (must be 0-5)");
        }

        const role = await findRoleByPermissionLevel(perm, null);
        if (role) {
            await dbRun("DELETE FROM user_roles WHERE userId = ? AND classId IS NULL", [id]);
            await dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, NULL)", [id, role.id]);
        }

        req.infoEvent("user.permissions.update.success", "User permissions updated", { targetUserId: id, permissionLevel: perm });

        res.status(200).json({
            success: true,
            data: {
                ok: true,
            },
        });
    });
};
