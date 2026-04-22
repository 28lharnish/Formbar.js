const { classStateStore } = require("@services/classroom-service");
const { getUser } = require("@services/user-service");
const { SCOPES } = require("@modules/permissions");
const { userHasScope } = require("@modules/scope-resolver");
const ValidationError = require("@errors/validation-error");
const ForbiddenError = require("@errors/forbidden-error");

/**
 * * Register api-permission-check controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    // Maps permissionType query params to scope strings
    const PERMISSION_TYPE_TO_SCOPE = {
        games: SCOPES.CLASS.GAMES.ACCESS,
        auxiliary: SCOPES.CLASS.AUXILIARY.CONTROL,
    };

    /**
     * @swagger
     * /api/v1/apiPermissionCheck:
     *   get:
     *     summary: Check API permissions for a class
     *     tags:
     *       - System
     *     description: |
     *       Checks whether a user (identified by API key) has a specific permission type
     *       within a given class. Used by external integrations (games, auxiliary tools)
     *       to verify access before performing actions.
     *     parameters:
     *       - in: query
     *         name: api
     *         required: true
     *         schema:
     *           type: string
     *         description: The user's API key
     *       - in: query
     *         name: permissionType
     *         required: true
     *         schema:
     *           type: string
     *           enum: [games, auxiliary]
     *         description: The type of permission to check
     *       - in: query
     *         name: classId
     *         required: true
     *         schema:
     *           type: string
     *         description: The class ID to check permissions in
     *     responses:
     *       200:
     *         description: Permission check passed
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
     *                     allowed:
     *                       type: boolean
     *                       example: true
     *       400:
     *         description: Missing or invalid query parameters
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       403:
     *         description: User is not logged in, not in the class, or lacks the required permission
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.get("/apiPermissionCheck", async (req, res) => {
        let { api, permissionType, classId } = req.query;
        req.infoEvent("api.permission.check.attempt", "Attempting API permission check", { permissionType, classId });

        if (!api) {
            throw new ValidationError("No API provided.", { event: "api.permission.check.failed", reason: "missing_api" });
        }

        if (!permissionType) {
            throw new ValidationError("No permissionType provided.", { event: "api.permission.check.failed", reason: "missing_permission_type" });
        }

        if (!classId) {
            throw new ValidationError("No classId provided.", { event: "api.permission.check.failed", reason: "missing_class_id" });
        }

        const scopeString = PERMISSION_TYPE_TO_SCOPE[permissionType];
        if (!scopeString) {
            throw new ValidationError("Invalid permissionType.", { event: "api.permission.check.failed", reason: "invalid_permission_type" });
        }

        const user = await getUser({ api });
        if (!user.loggedIn) {
            throw new ForbiddenError("User is not logged in.", { event: "api.permission.check.failed", reason: "not_logged_in" });
        }

        if (!user.classId) {
            throw new ForbiddenError("User is not in a class.", { event: "api.permission.check.failed", reason: "not_in_class" });
        }

        if (user.classId != classId) {
            throw new ForbiddenError("User is not in the requested class.", {
                event: "api.permission.check.failed",
                reason: "not_in_requested_class",
            });
        }

        // Look up the student object in the class state store for scope resolution
        const classroom = classStateStore.getClassroom(user.classId);
        const studentObj = classroom?.students?.[user.email];
        if (!studentObj) {
            throw new ForbiddenError("User is not in the requested class.", {
                event: "api.permission.check.failed",
                reason: "not_in_requested_class",
            });
        }

        if (!userHasScope(studentObj, scopeString, classroom)) {
            throw new ForbiddenError("User does not have enough permissions.", {
                event: "api.permission.check.failed",
                reason: "insufficient_permissions",
            });
        }

        req.infoEvent("api.permission.check.success", "API permission check passed", { permissionType, classId });

        if (req.originalUrl.startsWith("/api/v1")) {
            res.status(200).json({
                success: true,
                data: {
                    allowed: true,
                },
            });
        } else {
            res.status(200).json({
                success: true,
                allowed: true,
            });
        }
    });
};
