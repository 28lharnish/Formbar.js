const { unenrollFromClass } = require("@services/class-membership-service");
const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");

/**
 * * Register unenroll controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/unenroll:
     *   post:
     *     summary: Unenroll from a classroom
     *     tags:
     *       - Class
     *     description: |
     *       Unenrolls from the classroom entirely. The user is no longer attached to the classroom.
     *       This is different from leaving a class session - this completely removes the user from the classroom.
     *
     *       **Required Permission:** Class-specific `leaveRoom` permission
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
     *         description: Successfully unenrolled from the classroom
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/SuccessResponse'
     *       400:
     *         description: Unable to unenroll from classroom
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: Not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     */
    router.post("/class/:id/unenroll", isAuthenticated, async (req, res) => {
        const classId = Number(req.params.id);

        requireQueryParam(classId, "classId");

        req.infoEvent("class.unenroll.attempt", "User attempting to unenroll from class", { classId });

        await unenrollFromClass({ ...req.user, classId });

        req.infoEvent("class.unenroll.success", "User unenrolled from class successfully", { classId });
        res.status(200).json({
            success: true,
            data: {},
        });
    });
};
