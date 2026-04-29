const { isAuthenticated } = require("@middleware/authentication");
const { SCOPES } = require("@modules/permissions");
const { requireQueryParam } = require("@modules/error-wrapper");
const { userHasScope } = require("@modules/scope-resolver");
const { classStateStore } = require("@services/classroom-service");
const membershipService = require("@services/class-membership-service");
const NotFoundError = require("@errors/not-found-error");
const ForbiddenError = require("@errors/forbidden-error");

/**
 * Register delete controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}:
     *   delete:
     *     summary: Delete a classroom
     *     tags:
     *       - Class
     *     description: Deletes a classroom. The authenticated user must be the classroom owner or have sufficient permissions.
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: integer
     *         description: Classroom ID
     *     responses:
     *       200:
     *         description: Classroom deleted successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/SuccessResponse'
     *       403:
     *         description: Insufficient permissions to delete the classroom
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: Classroom not found
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
    router.delete(
        "/class/:id",
        isAuthenticated,
        async (req, res, next) => {
            const isOwner = await membershipService.classroomOwnerCheck(req);
            if (isOwner) {
                return next();
            }

            const classId = Number(req.params.id);
            const classroom = classStateStore.getClassroom(classId) || req._room || null;
            const user = classStateStore.getUser(req.user.email) || req.user;
            const classUser = classroom?.students?.[req.user.email] || user;

            if (userHasScope(user, SCOPES.GLOBAL.CLASS.DELETE)) {
                return next();
            }

            if (userHasScope(classUser, SCOPES.CLASS.SYSTEM.CAN_DELETE_CLASS, classroom)) {
                return next();
            }

            throw new ForbiddenError("You do not have permission to delete this classroom.");
        },
        async (req, res) => {
            const id = Number(req.params.id);

            requireQueryParam(id, "id");

            req.infoEvent("class.delete.attempt", "User attempting to delete classroom", { id });

            const room = req._room || (await membershipService.getClassroomById(id));
            if (!room) {
                throw new NotFoundError("Classroom not found");
            }

            await membershipService.deleteClassroom(room.id);

            req.infoEvent("class.delete.success", "Classroom deleted successfully", { id });
            res.status(200).json({
                success: true,
                data: {},
            });
        }
    );
};
