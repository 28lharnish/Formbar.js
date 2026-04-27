const { classStateStore } = require("@services/classroom-service");
const { isAuthenticated } = require("@middleware/authentication");
const { isClassMember } = require("@middleware/permission-check");
const ForbiddenError = require("@errors/forbidden-error");
const classService = require("@services/class-service");

/**
 * Register timer controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/timer:
     *   get:
     *     summary: Get class timer status
     *     tags:
     *       - Timer
     *     description: Returns the current timer state for a class. Requires the caller to be a member of the class.
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
     *         description: Timer status retrieved successfully
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
     *                     timer:
     *                       type: object
     *                       properties:
     *                         startTime:
     *                           type: number
     *                           description: Unix timestamp (ms) when the timer was started
     *                         endTime:
     *                           type: number
     *                           description: Unix timestamp (ms) when the timer will end
     *                         active:
     *                           type: boolean
     *                         sound:
     *                           type: boolean
     *       403:
     *         description: User is not a member of the class
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.get("/class/:id/timer", isAuthenticated, isClassMember(), async (req, res) => {
        const classId = req.params.id;
        req.infoEvent("class.timer.view.attempt", "Attempting to view class timer", { classId });

        const timer = classService.getTimer(classId);

        req.infoEvent("class.timer.view.success", "Class timer returned", { classId, timer: timer || { active: false } });
        res.status(200).json({
            success: true,
            data: {
                timer: timer || { active: false },
            },
        });
    });
};
