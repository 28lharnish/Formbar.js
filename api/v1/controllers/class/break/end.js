const { isOwnerHasScopesOrIsSelf } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const { classStateStore } = require("@services/classroom-service");
const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const { endBreak } = require("@services/class-service");
const ForbiddenError = require("@errors/forbidden-error");
const membershipService = require("@services/class-membership-service");

/**
 * Register end controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/break/end:
     *   post:
     *     summary: End your own break
     *     tags:
     *       - Class - Breaks
     *     description: |
     *       Ends the current user's break in a class.
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
     *         description: Break ended successfully
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
     *         description: Not authorized to end breaks in this class
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
    router.post("/class/:id/break/end", isAuthenticated, isOwnerHasScopesOrIsSelf(membershipService.classroomOwnerCheck, SCOPES.CLASS.BREAK.APPROVE, "You do not have permission to end this user's break."), async (req, res) => {
        const classId = Number(req.params.id);

        requireQueryParam(classId, "id");

        req.infoEvent("class.break.end.attempt", "Attempting to end user's break", { classId });

        const classroom = classStateStore.getClassroom(classId);
        if (classroom && !classroom.students[req.user.email]) {
            throw new ForbiddenError("You do not have permission to end this user's break.");
        }

        endBreak(req.user, classId);

        req.infoEvent("class.break.end.success", "User's break ended", { classId });
        res.status(200).json({
            success: true,
            data: {},
        });
    });
};
