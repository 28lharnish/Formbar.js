const { isAuthenticated } = require("@middleware/authentication");
const { hasClassScope } = require("@middleware/permission-check");
const { regenerateClassCode } = require("@services/class-service");
const { SCOPES } = require("@modules/permissions");
const { requireQueryParam } = require("@modules/error-wrapper");

/**
 * * Register regenerate-code controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/code/regenerate:
     *   post:
     *     summary: Regenerate the class code
     *     tags:
     *       - Class
     *     description: |
     *       Regenerates the classroom join code and returns the new code.
     *
     *       **Required scope:** `class.session.regenerate_code`
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
     *         description: Class code regenerated successfully
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
     *                     key:
     *                       type: string
     *                       description: Newly generated class code
     *                       example: ab12
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
     *         description: Classroom not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.post("/class/:id/code/regenerate", isAuthenticated, hasClassScope(SCOPES.CLASS.SESSION.REGENERATE_CODE), async (req, res) => {
        const classId = Number(req.params.id);

        requireQueryParam(classId, "id");

        req.infoEvent("class.code.regenerate.attempt", "Attempting to regenerate class code", { classId });

        const key = await regenerateClassCode(classId);

        req.infoEvent("class.code.regenerate.success", "Class code regenerated", { classId });
        res.status(200).json({
            success: true,
            data: { key },
        });
    });
};
