const { dbGet, dbGetAll } = require("@modules/database");
const { hasClassScope } = require("@middleware/permission-check");
const { classStateStore } = require("@services/classroom-service");
const { SCOPES } = require("@modules/permissions");
const { isAuthenticated } = require("@middleware/authentication");
const { buildPagination, parsePaginationQuery } = require("@modules/pagination");
const NotFoundError = require("@errors/not-found-error");

const DEFAULT_BANNED_LIMIT = 20;
const MAX_BANNED_LIMIT = 100;

/**
 * Register banned controller routes.
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
     *       Returns a paginated list of users banned from a classroom.
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
     *       - in: query
     *         name: limit
     *         required: false
     *         schema:
     *           type: integer
     *           default: 20
     *           minimum: 1
     *           maximum: 100
     *         description: Number of banned users to return per page
     *       - in: query
     *         name: offset
     *         required: false
     *         schema:
     *           type: integer
     *           default: 0
     *           minimum: 0
     *         description: Number of banned users to skip before returning results
     *     responses:
     *       200:
     *         description: Banned users retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 banned:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       id:
     *                         type: string
     *                       email:
     *                         type: string
     *                       displayName:
     *                         type: string
     *                 pagination:
     *                   type: object
     *                   properties:
     *                     total:
     *                       type: integer
     *                     limit:
     *                       type: integer
     *                     offset:
     *                       type: integer
     *                     hasMore:
     *                       type: boolean
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

        const { limit, offset } = parsePaginationQuery(req.query, DEFAULT_BANNED_LIMIT, MAX_BANNED_LIMIT);
        const totalRow = await dbGet(
            `SELECT COUNT(*) AS count
             FROM user_roles
             JOIN roles ON roles.id = user_roles.roleId
             WHERE user_roles.classId = ? AND INSTR(roles.scopes, ?) > 0`,
            [classId, SCOPES.CLASS.SYSTEM.BLOCKED]
        );
        const rows = await dbGetAll(
            `SELECT users.id, users.email, users.displayName
             FROM user_roles
             JOIN roles ON roles.id = user_roles.roleId
             JOIN users ON users.id = user_roles.userId
             WHERE user_roles.classId = ?
               AND INSTR(roles.scopes, ?) > 0
             ORDER BY LOWER(COALESCE(users.displayName, users.email)) ASC, users.id ASC
             LIMIT ? OFFSET ?`,
            [classId, SCOPES.CLASS.SYSTEM.BLOCKED, limit, offset]
        );
        res.status(200).json({
            success: true,
            data: {
                banned: rows || [],
                pagination: buildPagination(totalRow ? totalRow.count : 0, limit, offset, (rows || []).length),
            },
        });
    });
};
