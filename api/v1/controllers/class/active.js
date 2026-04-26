const { isClassMember } = require("@middleware/permission-check");
const { isClassActive } = require("@services/class-service");
const { isAuthenticated } = require("@middleware/authentication");

/**
 * Register active controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/active:
     *   get:
     *     summary: Check if class is active
     *     tags:
     *       - Class
     *     description: |
     *       Returns whether a class session is currently active.
     *       Any authenticated user who is a member of the classroom can check.
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
     *         description: Class status retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 isActive:
     *                   type: boolean
     *                   example: true
     *       401:
     *         description: Not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       403:
     *         description: Not a member of this class
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.get("/class/:id/active", isAuthenticated, isClassMember(), async (req, res) => {
        const classId = req.params.id;
        req.infoEvent("class.active.view.attempt", "Attempting to view class active status", { classId });

        const isActive = isClassActive(classId);
        req.infoEvent("class.active.view.success", "Class active status returned", { classId, isActive });
        res.status(200).json({
            success: true,
            data: {
                isActive,
            },
        });
    });
};
