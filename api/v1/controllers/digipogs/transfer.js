const { transferDigipogs } = require("@services/digipog-service");
const { getTransferFromValue, normalizeTransferFrom } = require("@modules/digipog-transfer");
const AppError = require("@errors/app-error");

/**
 * Register transfer controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/digipogs/transfer:
     *   post:
     *     summary: Transfer digipogs to another user
     *     tags:
     *       - Digipogs
     *     description: |
     *       Transfers digipogs from your account to another user.
     *
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - from
     *               - to
     *               - amount
     *               - pin
     *             properties:
     *               from:
     *                 oneOf:
     *                   - type: integer
     *                   - type: object
     *                 example: 1
     *                 description: Sender account. The PIN is validated against this sender.
     *               to:
     *                 type: string
     *                 example: "user123"
     *                 description: ID of the recipient user
     *               amount:
     *                 type: integer
     *                 example: 5
     *                 description: Number of digipogs to transfer
     *               pin:
     *                 type: string
     *                 example: "1234"
     *                 description: User's PIN for authentication
     *               reason:
     *                 type: string
     *                 example: "Payment for services"
     *                 description: Optional reason for the transfer
     *     responses:
     *       200:
     *         description: Digipogs transferred successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *       400:
     *         description: Missing required fields or invalid amount
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Transfer failed
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.post("/digipogs/transfer", async (req, res) => {
        const body = req.body || {};
        const requestedFrom = normalizeTransferFrom(getTransferFromValue(body));

        if (!requestedFrom) {
            throw new AppError("Missing sender identifier.", {
                statusCode: 400,
                event: "digipogs.transfer.failed",
                reason: "missing_sender",
            });
        }

        const transferPayload = {
            ...body,
            from: requestedFrom,
        };

        req.infoEvent("digipogs.transfer.attempt", "Attempting to transfer digipogs", {
            from: transferPayload.from,
            to: transferPayload.to,
            amount: transferPayload.amount,
        });

        const result = await transferDigipogs(transferPayload);
        if (!result.success) {
            throw new AppError(result.message, { statusCode: 400, event: "digipogs.transfer.failed", reason: "transfer_error" });
        }

        req.infoEvent("digipogs.transfer.success", "Digipogs transferred successfully", {
            from: transferPayload.from,
            to: transferPayload.to,
            amount: transferPayload.amount,
        });
        res.status(200).json({
            success: true,
            data: result,
        });
    });
};
