const { hasClassScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const { SCOPES } = require("@modules/permissions");
const classService = require("@services/class-service");

/**
 * * Register clear controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/timer/clear:
     *   post:
     *     summary: Clear a class timer
     *     tags:
     *       - Timer
     *     description: |
     *       Resets the timer for the specified class back to its default zeroed-out state.
     *
     *       **Required Permission:** `CLASS.TIMER.CONTROL`
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Class ID
     *     responses:
     *       200:
     *         description: Timer cleared successfully
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
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.post("/class/:id/timer/clear", isAuthenticated, hasClassScope(SCOPES.CLASS.TIMER.CONTROL), async (req, res) => {
        const classId = Number(req.params.id);
        requireQueryParam(classId, "id");

        req.infoEvent("class.timer.clear.attempt", "Attempting to clear a timer", { classId });

        classService.clearTimer(classId);

        req.infoEvent("class.timer.clear.success", "Timer cleared", { classId });
        res.status(200).json({
            success: true,
            data: {},
        });
    });
};
