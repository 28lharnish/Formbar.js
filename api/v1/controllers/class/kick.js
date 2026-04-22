const { isAuthenticated } = require("@middleware/authentication");
const { hasClassScope } = require("@middleware/permission-check");
const { classKickStudent, classKickStudents } = require("@services/class-service");
const { advancedEmitToClass } = require("@services/socket-updates-service");
const { SCOPES } = require("@modules/permissions");
const { requireQueryParam } = require("@modules/error-wrapper");

/**
 * * Register kick controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/students/{userId}/kick:
     *   post:
     *     summary: Kick a student from a class
     *     tags:
     *       - Class
     *     description: |
     *       Removes a student from the classroom roster and active session.
     *
     *       **Required scope:** `class.students.kick`
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
     *       - in: path
     *         name: userId
     *         required: true
     *         schema:
     *           type: string
     *         description: Student user ID to remove
     *     responses:
     *       200:
     *         description: Student was kicked successfully
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
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.post("/class/:id/students/:userId/kick", isAuthenticated, hasClassScope(SCOPES.CLASS.STUDENTS.KICK), async (req, res) => {
        const classId = Number(req.params.id);
        const userId = Number(req.params.userId);

        requireQueryParam(classId, "id");
        requireQueryParam(userId, "userId");

        req.infoEvent("class.kick.student.attempt", "Attempting to kick student from class", { classId, userId });

        await classKickStudent(userId, classId, { exitRoom: true, ban: false });
        await advancedEmitToClass("leaveSound", classId, {});

        req.infoEvent("class.kick.student.success", "Student kicked from class", { classId, userId });
        res.status(200).json({
            success: true,
            data: {},
        });
    });

    /**
     * * Handle the kick all students request.
     * @param {import("express").Request} req - req.
     * @param {import("express").Response} res - res.
     * @returns {Promise<void>}
     */
    const kickAllStudentsHandler = async (req, res) => {
        const classId = Number(req.params.id);
        const targetUserId = req.params.userId !== undefined ? Number(req.params.userId) : undefined;

        requireQueryParam(classId, "id");
        if (req.params.userId !== undefined) {
            requireQueryParam(targetUserId, "userId");
        }

        req.infoEvent("class.kick.all.attempt", "Attempting to kick all eligible students from class", { classId, targetUserId });

        await classKickStudents(classId);
        await advancedEmitToClass("kickStudentsSound", classId, { api: true });

        req.infoEvent("class.kick.all.success", "Kicked all students from class", { classId, targetUserId });
        res.status(200).json({
            success: true,
            data: {},
        });
    };

    /**
     * @swagger
     * /api/v1/class/{id}/students/{userId}/kick-all:
     *   post:
     *     summary: Kick all students from a class
     *     tags:
     *       - Class
     *     description: |
     *       Removes all students in the class who do not have teacher-level permissions.
     *       The `userId` path parameter is accepted for compatibility and is ignored by this operation.
     *
     *       **Required scope:** `class.students.kick`
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
     *       - in: path
     *         name: userId
     *         required: true
     *         schema:
     *           type: string
     *         description: Placeholder user ID (ignored)
     *     responses:
     *       200:
     *         description: Students were kicked successfully
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
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.post("/class/:id/students/:userId/kick-all", isAuthenticated, hasClassScope(SCOPES.CLASS.STUDENTS.KICK), kickAllStudentsHandler);
    router.post("/class/:id/students/kick-all", isAuthenticated, hasClassScope(SCOPES.CLASS.STUDENTS.KICK), kickAllStudentsHandler);
};
