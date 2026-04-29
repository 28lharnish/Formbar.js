const { isOwnerOrHasScopes } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const { classStateStore } = require("@services/classroom-service");
const { approveBreak } = require("@services/class-service");
const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const ForbiddenError = require("@errors/forbidden-error");
const AppError = require("@errors/app-error");
const membershipService = require("@services/class-membership-service");

/**
 * Register deny controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/students/{userId}/break/deny:
     *   post:
     *     summary: Deny a student's break request
     *     tags:
     *       - Class - Breaks
     *     description: |
     *       Denies a break request for a student in a class.
     *
     *       **Required Permission:** Class-specific `breakHelp` permission (default: Moderator)
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
     *       - in: path
     *         name: userId
     *         required: true
     *         schema:
     *           type: string
     *         description: Student user ID
     *     responses:
     *       200:
     *         description: Break request denied successfully
     *       401:
     *         description: Not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       403:
     *         description: Not authorized to deny breaks in this class
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
    router.post(
        "/class/:id/students/:userId/break/deny",
        isAuthenticated,
        isOwnerOrHasScopes(membershipService.classroomOwnerCheck, SCOPES.CLASS.BREAK.APPROVE, "You don't have permission to deny this user's break."),
        async (req, res) => {
            const classId = Number(req.params.id);
            const targetUserId = Number(req.params.userId);

            requireQueryParam(classId, "id");
            requireQueryParam(targetUserId, "userId");

            req.infoEvent("class.break.deny.attempt", "Attempting to deny user's break", { classId, targetUserId });

            const classroom = classStateStore.getClassroom(classId);
            if (classroom && !classroom.students[req.user.email]) {
                throw new ForbiddenError("You do not have permission to approve this user's break.");
            }

            const result = await approveBreak(false, targetUserId, req.user, classId);
            if (result === true) {
                req.infoEvent("class.break.deny.success", "User's break denied", { classId, targetUserId });
                res.status(200).json({
                    success: true,
                    data: {},
                });
            } else {
                throw new AppError(result, { statusCode: 500 });
            }
        }
    );
};
