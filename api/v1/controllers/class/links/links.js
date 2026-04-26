const { SCOPES } = require("@modules/permissions");
const { hasClassScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { isUserEnrolled, getClassLinksPaginated } = require("@services/class-membership-service");
const { requireQueryParam } = require("@modules/error-wrapper");
const { buildPagination, parsePaginationQuery } = require("@modules/pagination");
const ForbiddenError = require("@errors/forbidden-error");

const DEFAULT_LINK_LIMIT = 20;
const MAX_LINK_LIMIT = 100;

/**
 * Register links controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/links:
     *   get:
     *     summary: Get all links for a class
     *     tags:
     *       - Class - Links
     *     description: Retrieves paginated links associated with a classroom. Requires authentication and membership in the classroom.
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
     *         description: Number of links to return per page
     *       - in: query
     *         name: offset
     *         required: false
     *         schema:
     *           type: integer
     *           default: 0
     *           minimum: 0
     *         description: Number of links to skip before returning results
     *     responses:
     *       200:
     *         description: Links retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/LinksResponse'
     *             examples:
     *               success:
     *                 value:
     *                   success: true
     *                   data:
     *                     links:
     *                       - name: "Course Website"
     *                         url: "https://example.com"
     *       400:
     *         description: Bad request - missing or invalid parameters
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: Authentication required or invalid credentials
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       403:
     *         description: Insufficient permissions or not a member of the classroom
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
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *
     * components:
     *   schemas:
     *     Link:
     *       type: object
     *       properties:
     *         name:
     *           type: string
     *           example: "Course Website"
     *         url:
     *           type: string
     *           example: "https://example.com"
     *     LinksData:
     *       type: object
     *       properties:
     *         links:
     *           type: array
     *           items:
     *             $ref: '#/components/schemas/Link'
     *         pagination:
     *           type: object
     *           properties:
     *             total:
     *               type: integer
     *             limit:
     *               type: integer
     *             offset:
     *               type: integer
     *             hasMore:
     *               type: boolean
     *     LinksResponse:
     *       type: object
     *       properties:
     *         success:
     *           type: boolean
     *           example: true
     *         data:
     *           $ref: '#/components/schemas/LinksData'
     */
    router.get("/class/:id/links", isAuthenticated, hasClassScope(SCOPES.CLASS.LINKS.READ), async (req, res) => {
        const classId = req.params.id;
        requireQueryParam(classId, "id");
        req.infoEvent("class.links.view.attempt", "Attempting to view class links", { classId });

        const { limit, offset } = parsePaginationQuery(req.query, DEFAULT_LINK_LIMIT, MAX_LINK_LIMIT);
        const { links, total } = await getClassLinksPaginated(classId, limit, offset);
        if (links) {
            req.infoEvent("class.links.view.success", "Class links returned", { classId, linkCount: links.length });
            res.status(200).json({
                success: true,
                data: {
                    links,
                    pagination: buildPagination(total, limit, offset, links.length),
                },
            });
        }
    });
};
