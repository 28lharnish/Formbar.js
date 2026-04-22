const { enrollInClass } = require("@services/class-membership-service");
const { isAuthenticated } = require("@middleware/authentication");

/**
 * * Register enroll controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/enroll/{code}:
     *   post:
     *     summary: Enroll in a class with a code
     *     tags:
     *       - Class
     *     description: |
     *       Enrolls in a classroom using a class code.
     *
     *       **Required Permission:** Global Guest permission (level 1)
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
     *         name: code
     *         required: true
     *         schema:
     *           type: string
     *         description: Class code
     *     responses:
     *       200:
     *         description: Successfully enrolled in the class
     *       400:
     *         description: Invalid code or unable to enroll
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
    router.post("/class/enroll/:code", isAuthenticated, async (req, res) => {
        const code = req.params.code;
        req.infoEvent("class.enroll.attempt", "User attempting to enroll in class", { code });

        const response = await enrollInClass(req.user, code);

        req.infoEvent("class.enroll.success", "User enrolled in class successfully", { code });
        res.status(200).json({
            success: true,
            data: {
                roomId: response.roomId,
            },
        });
    });
};
