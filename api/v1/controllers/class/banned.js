const { dbGetAll } = require("@modules/database");
const { hasClassScope } = require("@middleware/permission-check");
const { classStateStore } = require("@services/classroom-service");
const { SCOPES, parseScopesField } = require("@modules/permissions");
const { isAuthenticated } = require("@middleware/authentication");
const NotFoundError = require("@errors/not-found-error");

/**
 * * Register banned controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/banned:
     *   get:
     *     summary: Get banned users in a class
     *     tags:
     *       - Class
     *     description: |
     *       Returns a list of users banned from a classroom.
     *
     *       **Required Permission:** Global Teacher permission (level 4)
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
     *         description: Banned users retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   id:
     *                     type: string
     *                   email:
     *                     type: string
     *                   displayName:
     *                     type: string
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
     *       404:
     *         description: Class not started
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.get("/class/:id/banned", isAuthenticated, hasClassScope(SCOPES.CLASS.STUDENTS.BAN), async (req, res) => {
        const classId = req.params.id;
        req.infoEvent("class.banned.view", "Viewing banned users for class", { classId });

        // Ensure class exists
        if (!classStateStore.getClassroom(classId)) {
            throw new NotFoundError("Class not started");
        }

        const rows = await dbGetAll(
            "SELECT users.id, users.email, users.displayName, roles.scopes FROM user_roles JOIN roles ON roles.id = user_roles.roleId JOIN users ON users.id = user_roles.userId WHERE user_roles.classId = ?",
            [classId]
        );
        res.status(200).json({
            success: true,
            data: (rows || [])
                .filter((row) => parseScopesField(row.scopes).includes(SCOPES.CLASS.SYSTEM.BLOCKED))
                .map(({ id, email, displayName }) => ({ id, email, displayName })),
        });
    });
};
