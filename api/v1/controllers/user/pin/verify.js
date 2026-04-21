const { isVerified, isAuthenticated } = require("@middleware/authentication");
const { verifyPin } = require("@services/user-service");
const { isValidPin } = require("@modules/pin-validation");
const { requireQueryParam } = require("@modules/error-wrapper");
const ValidationError = require("@errors/validation-error");
const ForbiddenError = require("@errors/forbidden-error");

/**
 * * Register verify controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/pin/verify:
     *   post:
     *     summary: Verify user PIN for sensitive actions
     *     tags:
     *       - Users
     *     description: |
     *       Verifies the authenticated user's PIN before unlocking sensitive information.
     *       Users may only verify the PIN for their own account.
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         description: The ID of the user whose PIN to verify
     *         schema:
     *           type: string
     *           example: "1"
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - pin
     *             properties:
     *               pin:
     *                 type: string
     *                 description: User PIN (4-6 numeric digits)
     *                 example: "1234"
     *     responses:
     *       200:
     *         description: PIN verified successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "PIN verified successfully."
     *       400:
     *         description: Validation error (invalid PIN format or PIN not configured)
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: PIN is incorrect
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       403:
     *         description: Cannot verify another user's PIN
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
    router.post("/user/:id/pin/verify", isAuthenticated, isVerified, async (req, res) => {
        const targetUserId = Number(req.params.id);
        requireQueryParam(targetUserId, "id");

        if (req.user.id !== targetUserId) {
            throw new ForbiddenError("You may only verify your own PIN.", {
                event: "user.pin.verify.failed",
                reason: "forbidden",
            });
        }

        const { pin } = req.body || {};
        if (!isValidPin(pin)) {
            throw new ValidationError("Invalid PIN format. PIN must be 4-6 numeric digits.", {
                event: "user.pin.verify.failed",
                reason: "invalid_pin_format",
            });
        }

        req.infoEvent("user.pin.verify.attempt", "Attempting to verify PIN", { userId: targetUserId });
        await verifyPin(targetUserId, pin);

        req.infoEvent("user.pin.verify.success", "PIN verified successfully", { userId: targetUserId });
        res.status(200).json({
            success: true,
            data: {
                message: "PIN verified successfully.",
            },
        });
    });
};
