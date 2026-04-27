const { hasClassScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const { SCOPES } = require("@modules/permissions");
const ValidationError = require("@errors/validation-error");
const classService = require("@services/class-service");

/**
 * Register end controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/timer/end:
     *   post:
     *     summary: End a class timer
     *     tags:
     *       - Timer
     *     description: |
     *       Stops the currently active timer for the specified class. The timer data is preserved but marked inactive.
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
     *         description: Timer ended successfully
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
     *         description: Timer is not active
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
    router.post("/class/:id/timer/end", isAuthenticated, hasClassScope(SCOPES.CLASS.TIMER.CONTROL), async (req, res) => {
        const classId = Number(req.params.id);
        requireQueryParam(classId, "id");

        req.infoEvent("class.timer.end.attempt", "Attempting to end a timer", { classId });

        const timer = classService.getTimer(classId);
        if (!timer) {
            throw new ValidationError("No current timer found for this class.");
        }

        if (!timer.active) {
            throw new ValidationError("Timer is not active.");
        }

        classService.endTimer(classId);

        req.infoEvent("class.timer.end.success", "Ended timer", { classId });
        res.status(200).json({
            success: true,
            data: {},
        });
    });
};
