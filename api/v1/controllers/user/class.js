const { classStateStore, getClassroomFromDb } = require("@services/classroom-service");
const { isAuthenticated } = require("@middleware/authentication");
const { isSelfOrHasScope } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const { requireQueryParam } = require("@modules/error-wrapper");
const { getUserDataFromDb } = require("@services/user-service");
const NotFoundError = require("@errors/not-found-error");

/**
 * Register class controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/class:
     *   get:
     *     summary: Get user's active class
     *     tags:
     *       - Users
     *     description: Retrieves the current class the user is in
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: User ID
     *     responses:
     *       200:
     *         description: Active class retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 id:
     *                   type: string
     *                   example: "abc123"
     *                 name:
     *                   type: string
     *                   example: "Math 101"
     *       403:
     *         description: Not authorized to view this user's active class
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: User is not in a class or class not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.get(
        "/user/:id/class",
        isAuthenticated,
        isSelfOrHasScope(SCOPES.GLOBAL.USERS.MANAGE, "Not authorized to view this user's active class."),
        async (req, res) => {
            const userId = req.params.id;
            requireQueryParam(userId, "id");
            req.infoEvent("user.class.view.attempt", "Attempting to view user active class", { targetUserId: userId });

            const requestedUser = await getUserDataFromDb(userId);
            if (!requestedUser) {
                throw new NotFoundError("User not found.");
            }

            const userInformation = classStateStore.getUser(requestedUser.email);
            if (!userInformation || !userInformation.activeClass) {
                throw new NotFoundError("User is not in a class.");
            }

            const classId = userInformation.activeClass;
            const classInfo = await getClassroomFromDb(classId);
            if (!classInfo) {
                throw new NotFoundError("Class not found.");
            }

            req.infoEvent("user.class.view.success", "User active class returned", { targetUserId: userId, classId });
            res.status(200).json({
                success: true,
                data: {
                    id: classId,
                    name: classInfo.name,
                },
            });
        }
    );
};
