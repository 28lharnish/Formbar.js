const { isAuthenticated } = require("@middleware/authentication");
const { isSelfOrHasScope } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const { requireQueryParam } = require("@modules/error-wrapper");
const userService = require("@services/user-service");

/**
 * * Register regenerate controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/api/regenerate:
     *   post:
     *     summary: Regenerate a user's API key
     *     tags:
     *       - Users
     *     description: Generates a new API key for the specified user and returns it. The plaintext key is only returned once — subsequent requests will return a different key.
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         description: The ID of the user whose API key should be regenerated
     *         schema:
     *           type: string
     *           example: "1"
     *     responses:
     *       200:
     *         description: API key regenerated successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 data:
     *                   type: object
     *                   properties:
     *                     apiKey:
     *                       type: string
     *                       description: The newly generated plaintext API key (shown only once)
     *                       example: "a3f1c2e4b5d6..."
     *       400:
     *         description: Missing required parameter
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ValidationError'
     *       401:
     *         description: Unauthorized
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.post(
        "/user/:id/api/regenerate",
        isAuthenticated,
        isSelfOrHasScope(SCOPES.GLOBAL.USERS.MANAGE, "You do not have permission to regenerate this user's API key."),
        async (req, res) => {
            const userId = Number(req.params.id);
            requireQueryParam(userId, "id");

            req.infoEvent("user.api.view", "Attempting to regenerate user API key", { targetUserId: userId });
            const apiKey = await userService.regenerateAPIKey(userId);
            req.infoEvent("user.api.regenerate.success", "User API key regenerated", { targetUserId: userId });

            res.status(200).json({
                success: true,
                data: {
                    apiKey: apiKey,
                },
            });
        }
    );
};
