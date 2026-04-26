const { getAllLogs, getLog } = require("@services/log-service");
const { hasScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { SCOPES } = require("@modules/permissions");
const { buildPagination, parsePaginationQuery } = require("@modules/pagination");

const DEFAULT_LOG_LIMIT = 20;
const MAX_LOG_LIMIT = 100;

/**
 * Register logs controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/logs:
     *   get:
     *     summary: Get all available logs
     *     tags:
     *       - Logs
     *     description: Returns a paginated list of available log files
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: query
     *         name: limit
     *         required: false
     *         schema:
     *           type: integer
     *           default: 20
     *           minimum: 1
     *           maximum: 100
     *         description: Number of logs to return per page
     *       - in: query
     *         name: offset
     *         required: false
     *         schema:
     *           type: integer
     *           default: 0
     *           minimum: 0
     *         description: Number of logs to skip before returning results
     *     responses:
     *       200:
     *         description: List of logs retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 logs:
     *                   type: array
     *                   items:
     *                     type: string
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
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.get("/logs", isAuthenticated, hasScope(SCOPES.GLOBAL.SYSTEM.ADMIN), async (req, res) => {
        req.infoEvent("logs.view_all", "Viewing all logs");
        const { limit, offset } = parsePaginationQuery(req.query, DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT);
        const allLogs = (await getAllLogs()).sort();
        const logs = allLogs.slice(offset, offset + limit);
        res.json({
            success: true,
            data: {
                logs,
                pagination: buildPagination(allLogs.length, limit, offset, logs.length),
            },
        });
    });

    /**
     * @swagger
     * /api/v1/logs/{log}:
     *   get:
     *     summary: Get specific log file contents
     *     tags:
     *       - Logs
     *     description: Returns the contents of a specific log file
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: log
     *         required: true
     *         description: The name of the log file to retrieve
     *         schema:
     *           type: string
     *           example: "application-info-2026-01-20-13.log"
     *     responses:
     *       200:
     *         description: Log contents retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 text:
     *                   type: string
     *       404:
     *         description: Log file not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.get("/logs/:log", isAuthenticated, hasScope(SCOPES.GLOBAL.SYSTEM.ADMIN), async (req, res) => {
        const logFileName = req.params.log;
        req.infoEvent("logs.view_single", "Viewing log file", { logFileName });
        const text = await getLog(logFileName);
        res.json({
            success: true,
            data: {
                text,
            },
        });
    });
};
