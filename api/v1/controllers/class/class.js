const { isAuthenticated } = require("@middleware/authentication");
const { classStateStore } = require("@services/classroom-service");
const { getClassUsers } = require("@services/class-service");
const { SCOPES } = require("@modules/permissions");
const { userHasScope } = require("@modules/scope-resolver");
const { requireQueryParam } = require("@modules/error-wrapper");
const NotFoundError = require("@errors/not-found-error");
const ForbiddenError = require("@errors/forbidden-error");

/**
 * Register class controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}:
     *   get:
     *     summary: Get class information
     *     tags:
     *       - Class
     *     description: Returns detailed information about a class session, including students and polls
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
     *         description: Class information retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Class'
     *       403:
     *         description: User is not logged into the selected class
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: Class not started or not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.get("/class/:id", isAuthenticated, async (req, res) => {
        const classId = req.params.id;
        requireQueryParam(classId, "id");

        // Log the request details
        req.infoEvent("class.view", "Viewing class data", { classId });

        // Get a clone of the class data
        // If the class does not exist, return an error
        const rawClassData = classStateStore.getClassroom(classId);
        if (!rawClassData) {
            throw new NotFoundError("Class not started");
        }

        // Get the user from the session, and if the user is not in the class, return an error
        const user = req.user;
        if (!rawClassData.students[user.email]) {
            throw new ForbiddenError("User is not logged into the selected class", { event: "class.user_not_in_class", reason: "user_not_in_class" });
        }

        // Get the users in the class
        const classUsers = await getClassUsers(user, rawClassData.key);

        // If an error occurs, log the error and return the error
        if (classUsers.error) {
            throw new NotFoundError(classUsers, { event: "class.users_error", reason: "retrieval_error" });
        }

        // Log the class data and send the response
        req.infoEvent("class.data_sent", "Class data sent to client", { classId, hasPolls: !!rawClassData.poll });
        res.status(200).json({
            success: true,
            data: {
                id: rawClassData.classId,
                name: rawClassData.className,
                isActive: rawClassData.isActive,
                owner: rawClassData.owner,
                students: userHasScope(rawClassData.students[user.email], SCOPES.CLASS.STUDENTS.READ, rawClassData)
                    ? classUsers
                    : { [user.email]: classUsers[user.email] },
                tags: rawClassData.tags,
                settings: rawClassData.settings,
                timer: rawClassData.timer,
                roles: rawClassData.availableRoles || [],
            },
        });
    });
};
