const { resetPin, requestPinReset } = require("@services/user-service");
const { isAuthenticated, isVerified } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const { settings } = require("@modules/config");
const { isValidPin } = require("@modules/pin-validation");
const AppError = require("@errors/app-error");
const ForbiddenError = require("@errors/forbidden-error");
const ValidationError = require("@errors/validation-error");

/**
 * * Register reset controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/pin/reset:
     *   post:
     *     summary: Request a PIN reset email
     *     tags:
     *       - Users
     *     description: |
     *       Sends a PIN reset email to the authenticated user. Only the user themselves
     *       may request a reset for their own PIN. Email service must be enabled.
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         description: The ID of the user requesting the PIN reset
     *         schema:
     *           type: string
     *           example: "1"
     *     responses:
     *       200:
     *         description: PIN reset email sent
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "PIN reset email has been sent."
     *       403:
     *         description: Cannot request a PIN reset for another user
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       503:
     *         description: Email service not enabled
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.post("/user/:id/pin/reset", isAuthenticated, isVerified, async (req, res) => {
        const targetUserId = Number(req.params.id);
        requireQueryParam(targetUserId, "id");

        // Users may only request a reset for their own PIN
        if (req.user.id !== targetUserId) {
            throw new ForbiddenError("You may only request a PIN reset for your own account.", {
                event: "user.pin.reset.request.failed",
                reason: "forbidden",
            });
        }

        if (!settings.emailEnabled) {
            throw new AppError("Email service is not enabled. PIN resets are not available at this time.", {
                statusCode: 503,
                event: "user.pin.reset.request.failed",
                reason: "email_disabled",
            });
        }

        req.infoEvent("user.pin.reset.request", "PIN reset requested", { userId: targetUserId });
        await requestPinReset(targetUserId);

        req.infoEvent("user.pin.reset.request.success", "PIN reset email sent");
        res.status(200).json({
            success: true,
            data: {
                message: "PIN reset email has been sent.",
            },
        });
    });

    /**
     * @swagger
     * /api/v1/user/pin/reset:
     *   patch:
     *     summary: Reset PIN using a token
     *     tags:
     *       - Users
     *     description: |
     *       Resets a user's PIN using a token received via email.
     *
     *       **Required Permission:** None (public endpoint, requires valid reset token)
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - pin
     *               - token
     *             properties:
     *               pin:
     *                 type: string
     *                 description: New PIN (4-6 numeric digits)
     *                 example: "1234"
     *               token:
     *                 type: string
     *                 description: PIN reset token received via email
     *     responses:
     *       200:
     *         description: PIN reset successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "PIN has been reset successfully."
     *       400:
     *         description: Validation error (missing fields or invalid PIN format)
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: Token is invalid or has expired
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
    router.patch("/user/pin/reset", async (req, res) => {
        const { pin, token } = req.body;

        if (!token) {
            throw new ValidationError("Token is required.", {
                event: "user.pin.reset.failed",
                reason: "missing_token",
            });
        }

        if (!isValidPin(pin)) {
            throw new ValidationError("Invalid PIN format. PIN must be 4-6 numeric digits.", {
                event: "user.pin.reset.failed",
                reason: "invalid_pin_format",
            });
        }

        req.infoEvent("user.pin.reset.attempt", "Attempting to reset PIN with token");
        await resetPin(pin, token);

        req.infoEvent("user.pin.reset.success", "PIN reset successfully");
        res.status(200).json({
            success: true,
            data: {
                message: "PIN has been reset successfully.",
            },
        });
    });
};
