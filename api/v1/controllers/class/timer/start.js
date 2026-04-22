const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const { SCOPES } = require("@modules/permissions");
const { hasClassScope } = require("@middleware/permission-check");
const ForbiddenError = require("@errors/forbidden-error");
const ValidationError = require("@errors/validation-error");
const classService = require("@services/class-service");
const { classStateStore } = require("@services/classroom-service");

/**
 * * Register start controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/timer/start:
     *   post:
     *     summary: Start a class timer
     *     tags:
     *       - Timer
     *     description: |
     *       Starts a countdown timer for the specified class.
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
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - duration
     *             properties:
     *               duration:
     *                 type: integer
     *                 description: Timer duration in milliseconds
     *                 example: 300000
     *               sound:
     *                 type: boolean
     *                 description: Whether to play a sound when the timer ends
     *                 default: false
     *     responses:
     *       200:
     *         description: Timer started successfully
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
     *         description: Duration is required or invalid
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       403:
     *         description: Insufficient permissions or classroom not loaded
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.post("/class/:id/timer/start", isAuthenticated, hasClassScope(SCOPES.CLASS.TIMER.CONTROL), async (req, res) => {
        const classId = Number(req.params.id);
        let { duration, sound } = req.body;
        requireQueryParam(classId, "id");

        if (duration === undefined || duration === null) {
            throw new ValidationError("Duration is required.");
        }

        duration = Number(duration);

        if (!Number.isInteger(duration)) {
            throw new ValidationError("Duration must be an integer.");
        }

        if (duration <= 0) {
            throw new ValidationError("Duration must be greater than 0.");
        }

        if (typeof sound !== "undefined" && typeof sound !== "boolean") {
            throw new ValidationError("Sound must be a boolean.");
        }

        req.infoEvent("class.timer.start.attempt", "Attempting to start a timer", { classId });

        const classroom = classStateStore.getClassroom(classId);
        if (!classroom) {
            throw new ForbiddenError("Classroom is not currently loaded.");
        }

        classService.startTimer({ classId, duration, sound });

        req.infoEvent("class.timer.start.success", "Timer successfully started", { classId });
        res.status(200).json({
            success: true,
            data: {},
        });
    });
};
