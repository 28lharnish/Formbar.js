const { SCOPES } = require("@modules/permissions");
const { dbRun } = require("@modules/database");
const { hasClassScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const ValidationError = require("@errors/validation-error");

/**
 * Register remove controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * Handle the remove link request.
     * @param {import("express").Request} req - req.
     * @param {import("express").Response} res - res.
     * @returns {Promise<void>}
     */
    const removeLinkHandler = async (req, res) => {
        const classId = req.params.id;
        const { name } = req.body;
        req.infoEvent("class.links.remove.attempt", "Attempting to remove class link", { classId, linkName: name });
        if (!name) {
            throw new ValidationError("Name is required.");
        }

        // Remove the link from the database
        await dbRun("DELETE FROM links WHERE classId = ? AND name = ?", [classId, name]);
        req.infoEvent("class.links.remove.success", "Class link removed", { classId, linkName: name });
        res.status(200).json({
            success: true,
            data: {
                message: "Link removed successfully.",
            },
        });
    };

    /**
     * @swagger
     * /api/v1/class/{id}/links:
     *   delete:
     *     summary: Remove a link from a class
     *     tags:
     *       - Class - Links
     *     description: Removes a link from a classroom (requires teacher permissions)
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
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - name
     *             properties:
     *               name:
     *                 type: string
     *                 example: "Course Website"
     *     responses:
     *       200:
     *         description: Link removed successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "Link removed successfully."
     *       400:
     *         description: Name is required
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.delete("/class/:id/links", isAuthenticated, hasClassScope(SCOPES.CLASS.LINKS.MANAGE), removeLinkHandler);

    // Deprecated endpoint - kept for backwards compatibility, use DELETE /api/v1/class/:id/links instead
    router.post("/class/:id/links/remove", isAuthenticated, hasClassScope(SCOPES.CLASS.LINKS.MANAGE), async (req, res) => {
        res.setHeader("X-Deprecated", "Use DELETE /api/v1/class/:id/links instead");
        res.setHeader(
            "Warning",
            '299 - "Deprecated API: Use DELETE /api/v1/class/:id/links instead. This endpoint will be removed in a future version."'
        );
        await removeLinkHandler(req, res);
    });
};
