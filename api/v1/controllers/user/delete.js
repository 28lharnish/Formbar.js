const { deleteUser } = require("@services/user-service");
const { SCOPES } = require("@modules/permissions");
const { hasScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const AppError = require("@errors/app-error");

/**
 * Register delete controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}:
     *   delete:
     *     summary: Delete a user
     *     tags:
     *       - Users
     *     description: Deletes a user from Formbar (requires manager permissions)
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: User ID
     *     responses:
     *       200:
     *         description: User deleted successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/SuccessResponse'
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Delete operation failed
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.delete("/user/:id", isAuthenticated, hasScope(SCOPES.GLOBAL.USERS.MANAGE), async (req, res) => {
        const userId = req.params.id;
        req.infoEvent("user.delete.attempt", "Attempting to delete user");

        const result = await deleteUser(userId);
        if (result === true) {
            req.infoEvent("user.delete.success", "User deleted successfully");
            res.status(200).json({
                success: true,
                data: {},
            });
        } else {
            throw new AppError(result, { event: "user.delete.failed", reason: "deletion_error" });
        }
    });
};
