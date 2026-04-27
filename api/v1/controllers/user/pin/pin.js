const { isVerified, isAuthenticated } = require("@middleware/authentication");
const { updatePin } = require("@services/user-service");
const { isValidPin } = require("@modules/pin-validation");
const ValidationError = require("@errors/validation-error");
const ForbiddenError = require("@errors/forbidden-error");
const { requireQueryParam } = require("@modules/error-wrapper");

/**
 * Register pin controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/pin:
     *   patch:
     *     summary: Update user PIN
     *     tags:
     *       - Users
     *     description: |
     *       Updates the authenticated user's PIN. Requires the current PIN if one is already set.
     *       Users may only update their own PIN. The PIN must be 4-6 numeric digits.
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         description: The ID of the user whose PIN to update
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
     *               oldPin:
     *                 type: string
     *                 description: Current PIN (required if a PIN is already set)
     *                 example: "1234"
     *               pin:
     *                 type: string
     *                 description: New PIN (4-6 numeric digits)
     *                 example: "5678"
     *     responses:
     *       200:
     *         description: PIN updated successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "PIN updated successfully."
     *       400:
     *         description: Validation error (missing or invalid PIN format)
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: Current PIN is incorrect
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       403:
     *         description: Cannot modify another user's PIN
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
    router.patch("/user/:id/pin", isAuthenticated, isVerified, async (req, res) => {
        const targetUserId = Number(req.params.id);
        requireQueryParam(targetUserId, "id");

        // Users may only update their own PIN
        if (req.user.id !== targetUserId) {
            throw new ForbiddenError("You may only update your own PIN.", {
                event: "user.pin.update.failed",
                reason: "forbidden",
            });
        }

        const { oldPin, pin } = req.body;

        if (!isValidPin(pin)) {
            throw new ValidationError("Invalid PIN format. PIN must be 4-6 numeric digits.", {
                event: "user.pin.update.failed",
                reason: "invalid_pin_format",
            });
        }

        req.infoEvent("user.pin.update.attempt", "Attempting to update PIN", { userId: targetUserId });
        await updatePin(targetUserId, oldPin, pin);

        req.infoEvent("user.pin.update.success", "PIN updated successfully");
        res.status(200).json({
            success: true,
            data: {
                message: "PIN updated successfully.",
            },
        });
    });
};
