const { SCOPES } = require("@modules/permissions");
const { getManagerDataPaginated } = require("@services/manager-service");
const { hasScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const ValidationError = require("@errors/validation-error");

const DEFAULT_MANAGER_LIMIT = 24;
const MAX_MANAGER_LIMIT = 200;

/**
 * * Parse an integer query parameter.
 * @param {string|number|undefined} value - Query value.
 * @param {number} defaultValue - Default value.
 * @returns {number}
 */
function parseIntegerQueryParam(value, defaultValue) {
    if (value == null) {
        return defaultValue;
    }

    const text = `${value}`.trim();
    if (!/^-?\d+$/.test(text)) {
        return NaN;
    }

    return Number.parseInt(text, 10);
}

/**
 * * Register manager controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/manager:
     *   get:
     *     summary: Get manager data
     *     tags:
     *       - Manager
     *     description: |
     *       Retrieves all users and classrooms for manager view.
     *
     *       **Required Permission:** Global Manager permission (level 5)
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
     *       - in: query
     *         name: limit
     *         required: false
     *         description: Number of users to return per page
     *         schema:
     *           type: integer
     *           minimum: 1
     *           maximum: 200
     *           default: 24
     *       - in: query
     *         name: offset
     *         required: false
     *         description: Number of users to skip before returning results
     *         schema:
     *           type: integer
     *           minimum: 0
     *           default: 0
     *       - in: query
     *         name: search
     *         required: false
     *         description: Case-insensitive search term matched against user display name and email
     *         schema:
     *           type: string
     *       - in: query
     *         name: sortBy
     *         required: false
     *         description: Sort key for returned users
     *         schema:
     *           type: string
     *           enum: [name, permission]
     *           default: name
     *     responses:
     *       200:
     *         description: Manager data retrieved successfully
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
     *                     users:
     *                       type: array
     *                       items:
     *                         $ref: '#/components/schemas/User'
     *                     classrooms:
     *                       type: array
     *                       items:
     *                         $ref: '#/components/schemas/ClassInfo'
     *                     pendingUsers:
     *                       type: array
     *                       items:
     *                         type: object
     *                         additionalProperties: true
     *                     pagination:
     *                       type: object
     *                       properties:
     *                         total:
     *                           type: integer
     *                         limit:
     *                           type: integer
     *                         offset:
     *                           type: integer
     *                         hasMore:
     *                           type: boolean
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
    router.get("/manager", isAuthenticated, hasScope(SCOPES.GLOBAL.SYSTEM.ADMIN), async (req, res) => {
        req.infoEvent("manager.view", "Manager dashboard accessed");

        const limit = parseIntegerQueryParam(req.query.limit, DEFAULT_MANAGER_LIMIT);
        const offset = parseIntegerQueryParam(req.query.offset, 0);
        const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
        const sortBy = typeof req.query.sortBy === "string" ? req.query.sortBy.trim().toLowerCase() : "name";

        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MANAGER_LIMIT) {
            throw new ValidationError(`Invalid limit. Expected an integer between 1 and ${MAX_MANAGER_LIMIT}.`);
        }

        if (!Number.isInteger(offset) || offset < 0) {
            throw new ValidationError("Invalid offset. Expected a non-negative integer.");
        }

        if (sortBy !== "name" && sortBy !== "permission") {
            throw new ValidationError("Invalid sortBy. Expected 'name' or 'permission'.");
        }

        // Grab manager data and send it back as a JSON response
        const { users, classrooms, pendingUsers, totalUsers } = await getManagerDataPaginated({
            limit,
            offset,
            search,
            sortBy,
        });
        const hasMore = offset + users.length < totalUsers;

        req.infoEvent("manager.data.retrieved", "Manager data retrieved");
        res.status(200).json({
            success: true,
            data: {
                users,
                classrooms,
                pendingUsers,
                pagination: {
                    total: totalUsers,
                    limit,
                    offset,
                    hasMore,
                },
            },
        });
    });
};
