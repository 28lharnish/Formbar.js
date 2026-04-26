const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const { SCOPES } = require("@modules/permissions");
const { hasClassScope } = require("@middleware/permission-check");
const ValidationError = require("@errors/validation-error");
const classService = require("@services/class-service");

/**
 * Register pause controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/timer/pause:
     *   post:
     *     summary: Pauses a class timer
     *     tags:
     *       - Timer
     *     description: |
     *       Pauses a countdown timer for the specified class.
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
     *         description: Timer paused successfully
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
     *       400:
     *         description: Bad request – validation error (e.g., no current timer found or timer is not active)
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.post("/class/:id/timer/pause", isAuthenticated, hasClassScope(SCOPES.CLASS.TIMER.CONTROL), async (req, res) => {
        const classId = Number(req.params.id);
        requireQueryParam(classId, "id");

        req.infoEvent("class.timer.pause.attempt", "Attempting to pause a timer", { classId });

        const timer = classService.getTimer(classId);
        if (!timer) {
            throw new ValidationError("No current timer found for this class.");
        }

        if (!timer.active) {
            throw new ValidationError("Cannot pause timer because it is not active.");
        }

        classService.pauseTimer(classId);

        req.infoEvent("class.timer.pause.success", "Timer paused", { classId });
        res.status(200).json({
            success: true,
            data: {},
        });
    });
};
