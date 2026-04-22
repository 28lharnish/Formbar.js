const { settings } = require("@modules/config");
const { getAvailableProviders } = require("@modules/oidc");

/**
 * * Register config controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/config:
     *   get:
     *     summary: Get server configuration
     *     tags:
     *       - System
     *     description: Returns public server configuration flags indicating which features are enabled.
     *     responses:
     *       200:
     *         description: Server configuration returned successfully
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
     *                     emailEnabled:
     *                       type: boolean
     *                       description: Whether the email service is enabled
     *                     oidcProviders:
     *                       type: array
     *                       description: The available OIDC providers
     *                       items:
     *                         type: string
     *                         example: google
     *                         description: The OIDC provider identifier
     *                       example: [google, microsoft]
     */
    router.get("/config", (req, res) => {
        req.infoEvent("config.view.attempt", "Attempting to read the server configuration");
        req.infoEvent("config.view.success", "Server configuration returned");
        res.json({
            success: true,
            data: {
                emailEnabled: settings.emailEnabled,
                oidcProviders: getAvailableProviders(),
            },
        });
    });
};
