const { SCOPES } = require("@modules/permissions");
const { hasClassScope } = require("@middleware/permission-check");
const { dbRun } = require("@modules/database");
const { isAuthenticated } = require("@middleware/authentication");
const ValidationError = require("@errors/validation-error");

/**
 * Register add controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/links/add:
     *   post:
     *     summary: Add a link to a class
     *     tags:
     *       - Class - Links
     *     description: Adds a new link to a classroom (requires teacher permissions)
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
     *               - url
     *             properties:
     *               name:
     *                 type: string
     *                 example: "Course Website"
     *               url:
     *                 type: string
     *                 example: "https://example.com"
     *     responses:
     *       200:
     *         description: Link added successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "Link added successfully."
     *       400:
     *         description: Name and URL are required
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
    router.post("/class/:id/links/add", isAuthenticated, hasClassScope(SCOPES.CLASS.LINKS.MANAGE), async (req, res) => {
        const classId = req.params.id;
        const { name, url } = req.body;
        req.infoEvent("class.links.add.attempt", "Attempting to add class link", { classId, linkName: name });
        if (!name || !url) {
            throw new ValidationError("Name and URL are required.");
        }

        // Add the link to the database
        await dbRun("INSERT INTO links (classId, name, url) VALUES (?, ?, ?)", [classId, name, url]);
        req.infoEvent("class.links.add.success", "Class link added", { classId, linkName: name });
        res.status(200).json({
            success: true,
            data: {
                message: "Link added successfully.",
            },
        });
    });
};
