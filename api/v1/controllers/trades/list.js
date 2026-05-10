const { isAuthenticated, isVerified } = require("@middleware/authentication");
const { getTradesForUser } = require("@services/trade-service");
const ValidationError = require("@errors/validation-error");

/**
 * Register trades list controller routes.
 * @param {import("express").Router} router
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/trades:
     *   get:
     *     summary: List the current user's trades
     *     description: >
     *       Returns the current user's trades organized into four buckets:
     *       `inbound` (pending trades where the user is the recipient),
     *       `outbound` (pending trades where the user is the requester),
     *       `completed` (accepted and exchanged trades), and
     *       `inactive` (rejected, canceled, or failed trades).
     *       Each bucket includes its own pagination metadata.
     *     tags: [Trades]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 20
     *         description: Maximum number of trades per bucket
     *       - in: query
     *         name: offset
     *         schema:
     *           type: integer
     *           default: 0
     *         description: Number of trades to skip per bucket
     *     responses:
     *       200:
     *         description: Trade buckets returned successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 data:
     *                   type: object
     *                   properties:
     *                     inbound:
     *                       $ref: '#/components/schemas/TradeBucket'
     *                     outbound:
     *                       $ref: '#/components/schemas/TradeBucket'
     *                     completed:
     *                       $ref: '#/components/schemas/TradeBucket'
     *                     inactive:
     *                       $ref: '#/components/schemas/TradeBucket'
     *       401:
     *         description: Not authenticated
     */
    router.get("/trades", isAuthenticated, isVerified, async (req, res) => {
        const limit = req.query.limit !== undefined ? Number(req.query.limit) : 20;
        const offset = req.query.offset !== undefined ? Number(req.query.offset) : 0;

        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new ValidationError("limit must be an integer between 1 and 100.", { reason: "invalid_limit" });
        }
        if (!Number.isInteger(offset) || offset < 0) {
            throw new ValidationError("offset must be a non-negative integer.", { reason: "invalid_offset" });
        }

        req.infoEvent("trades.list", "Fetching trade buckets", { userId: req.user.id });

        const buckets = await getTradesForUser(req.user.id, { limit, offset });
        res.status(200).json({ success: true, data: buckets });
    });
};
