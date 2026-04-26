const { hasClassScope, isClassMember } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const { classStateStore } = require("@services/classroom-service");
const { setTags } = require("@services/class-service");
const { isAuthenticated } = require("@middleware/authentication");
const NotFoundError = require("@errors/not-found-error");
const ValidationError = require("@errors/validation-error");

/**
 * Register tags controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * Ensure the requested class is loaded in memory.
     * @param {import("express").Request} req - req.
     * @param {import("express").Response} res - res.
     * @param {import("express").NextFunction} next - next.
     * @returns {void}
     */
    const ensureClassLoaded = (req, res, next) => {
        const classId = req.params.id;
        if (!classId || !classStateStore.getClassroom(classId)) {
            throw new NotFoundError("Class not found or not loaded.");
        }
        next();
    };

    /**
     * Handle the set tags request.
     * @param {import("express").Request} req - req.
     * @param {import("express").Response} res - res.
     * @returns {Promise<void>}
     */
    const setTagsHandler = async (req, res) => {
        const classId = req.params.id;
        req.infoEvent("class.tags.update.attempt", "Attempting to update class tags", { classId });
        if (!classId || !classStateStore.getClassroom(classId)) {
            throw new NotFoundError("Class not found or not loaded.");
        }

        let { tags } = req.body || {};
        if (!Array.isArray(tags)) {
            throw new ValidationError("tags must be an array of strings");
        }

        await setTags(tags, req.user);
        req.infoEvent("class.tags.update.success", "Class tags updated", { classId, tagCount: tags.length });
        res.status(200).json({
            success: true,
            data: {},
        });
    };

    /**
     * @swagger
     * /api/v1/class/{id}/tags:
     *   get:
     *     summary: Get current class tags
     *     tags:
     *       - Class
     *     description: |
     *       Returns the current tags for the classroom.
     *
     *       **Required Permission:** Authenticated user in an active class session
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     responses:
     *       200:
     *         description: Tags retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 tags:
     *                   type: array
     *                   items:
     *                     type: string
     *                   example: ["math", "science"]
     *       404:
     *         description: Class not found or not loaded
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.get("/class/:id/tags", isAuthenticated, ensureClassLoaded, isClassMember(), async (req, res) => {
        const classId = req.params.id;
        req.infoEvent("class.tags.view.attempt", "Attempting to view class tags", { classId });
        if (!classId || !classStateStore.getClassroom(classId)) {
            throw new NotFoundError("Class not found or not loaded.");
        }

        const tags = classStateStore.getClassroom(classId).tags || [];
        req.infoEvent("class.tags.view.success", "Class tags returned", { classId, tagCount: tags.length });
        return res.status(200).json({
            success: true,
            data: {
                tags,
            },
        });
    });

    /**
     * @swagger
     * /api/v1/class/{id}/tags:
     *   put:
     *     summary: Set class tags
     *     tags:
     *       - Class
     *     description: |
     *       Sets (replaces) the tags for the current classroom.
     *
     *       **Required Permission:** Class-specific `setTags` permission
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - tags
     *             properties:
     *               tags:
     *                 type: array
     *                 items:
     *                   type: string
     *                 example: ["math", "science"]
     *     responses:
     *       200:
     *         description: Tags set successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/SuccessResponse'
     *       400:
     *         description: Tags must be an array of strings
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: Class not found or not loaded
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.put("/class/:id/tags", isAuthenticated, hasClassScope(SCOPES.CLASS.TAGS.MANAGE), setTagsHandler);

    // Deprecated endpoint - kept for backwards compatibility, use PUT /api/v1/class/:id/tags instead
    router.post("/class/:id/tags", isAuthenticated, hasClassScope(SCOPES.CLASS.TAGS.MANAGE), async (req, res) => {
        res.setHeader("X-Deprecated", "Use PUT /api/v1/class/:id/tags instead");
        res.setHeader(
            "Warning",
            '299 - "Deprecated API: Use PUT /api/v1/class/:id/tags instead. This endpoint will be removed in a future version."'
        );
        await setTagsHandler(req, res);
    });
};
