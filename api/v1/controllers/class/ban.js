const { isAuthenticated } = require("@middleware/authentication");
const { isOwnerOrHasScopes } = require("@middleware/permission-check");
const { advancedEmitToClass } = require("@services/socket-updates-service");
const { SCOPES } = require("@modules/permissions");
const { requireQueryParam } = require("@modules/error-wrapper");
const membershipService = require("@services/class-membership-service");

/**
 * Register ban controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/students/{userId}/ban:
     *   post:
     *     summary: Ban a student from a class
     *     tags:
     *       - Class
     *     description: |
     *       Applies the banned role to a student and removes them from the active session.
     *
     *       **Required scope:** `class.students.ban`
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
     *         description: Student user ID to ban
     *     responses:
     *       200:
     *         description: Student was banned successfully
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
    router.post(
        "/class/:id/students/:userId/ban",
        isAuthenticated,
        isOwnerOrHasScopes(membershipService.classroomOwnerCheck, SCOPES.CLASS.STUDENTS.BAN, "You do not have permission to ban this student."),
        async (req, res) => {
            const classId = Number(req.params.id);
            const userId = Number(req.params.userId);

            requireQueryParam(classId, "id");
            requireQueryParam(userId, "userId");

            req.infoEvent("class.ban.student.attempt", "Attempting to ban student from class", { classId, userId });

            await membershipService.setClassroomBanStatus(classId, userId, true);
            await advancedEmitToClass("leaveSound", classId, {});

            req.infoEvent("class.ban.student.success", "Student banned from class", { classId, userId });
            res.status(200).json({
                success: true,
                data: {},
            });
        }
    );
};
