const { hasClassScope } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const { classStateStore } = require("@services/classroom-service");
const { sendHelpTicket } = require("@services/class-service");
const { isAuthenticated } = require("@middleware/authentication");
const ForbiddenError = require("@errors/forbidden-error");
const AppError = require("@errors/app-error");

/**
 * Register request controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/help/request:
     *   post:
     *     summary: Request help in a class
     *     tags:
     *       - Class - Help
     *     description: |
     *       Submits a help request in a class session.
     *
     *       **Required Permission:** Class-specific Student permission (level 2)
     *
     *       **Permission Levels:**
     *       - 1: Guest
     *       - 2: Student
     *       - 3: Moderator
     *       - 4: Teacher
     *       - 5: Manager
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
     *         description: Help request submitted successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/SuccessResponse'
     *       401:
     *         description: Not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       403:
     *         description: Not authorized to request help in this class
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
    router.post("/class/:id/help/request", isAuthenticated, hasClassScope(SCOPES.CLASS.HELP.REQUEST), async (req, res) => {
        const classId = req.params.id;
        req.infoEvent("class.help.request.attempt", "Attempting to request class help", { classId });
        const classroom = classStateStore.getClassroom(classId);
        if (classroom && !classroom.students[req.user.email]) {
            throw new ForbiddenError("You do not have permission to request help in this class.");
        }

        const reason = req.body.reason || "General help request";
        const userData = { ...req.user, classId };
        const result = await sendHelpTicket(reason, userData);
        if (result === true) {
            req.infoEvent("class.help.request.success", "Class help requested", { classId });
            res.status(200).json({
                success: true,
                data: {},
            });
        } else {
            throw new AppError(result, { statusCode: 500 });
        }
    });
};
