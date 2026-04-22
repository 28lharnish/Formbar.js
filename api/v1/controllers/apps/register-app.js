const { isAuthenticated } = require("@middleware/authentication");
const ValidationError = require("@errors/validation-error");
const appService = require("@services/app-service");

const maxAppNameLength = 100;
const maxAppDescriptionLength = 500;

/**
 * * Register register-app controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/apps/register:
     *   post:
     *     summary: Register a new application
     *     tags:
     *       - Apps
     *     description: |
     *       Registers a new third-party application owned by the authenticated user.
     *       Returns the app id, an apiKey and an apiSecret (the secret is shown only once).
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - name
     *               - description
     *             properties:
     *               name:
     *                 type: string
     *                 description: The display name of the application
     *                 example: "Homework Helper"
     *               description:
     *                 type: string
     *                 description: A short description of the application
     *                 example: "An app to assist students with homework"
     *     responses:
     *       200:
     *         description: Application registered successfully
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
     *                     appId:
     *                       type: integer
     *                       example: 1
     *                     apiKey:
     *                       type: string
     *                       description: The newly generated API key for the app
     *                     apiSecret:
     *                       type: string
     *                       description: The newly generated plaintext secret - shown only once
     *       400:
     *         description: Validation error (missing fields or too long)
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
    router.post("/apps/register", isAuthenticated, async (req, res) => {
        const { name, description } = req.body;

        req.infoEvent("apps.register.attempt", "User is attempting to register a new app", { name });

        if (typeof name !== "string" || !name || typeof description !== "string" || !description) {
            throw new ValidationError("Name and description are required to register an app.", {
                reason: "missing_fields",
                event: "apps.register.failed",
            });
        }

        if (name.length > maxAppNameLength) {
            throw new ValidationError(`App name cannot exceed ${maxAppNameLength} characters.`, {
                reason: "name_too_long",
                event: "apps.register.failed",
            });
        }

        if (description.length > maxAppDescriptionLength) {
            throw new ValidationError(`App description cannot exceed ${maxAppDescriptionLength} characters.`, {
                reason: "description_too_long",
                event: "apps.register.failed",
            });
        }

        const { appId, apiKey, apiSecret } = await appService.createApp({ name, description, ownerId: req.user.id });

        req.infoEvent("apps.register.success", "App registered successfully", { appId });

        res.json({
            success: true,
            data: { appId, apiKey, apiSecret },
        });
    });
};
