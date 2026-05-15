const appService = require("@services/app-service");
const { requireParam } = require("@modules/error-wrapper");
const ValidationError = require("@errors/validation-error");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/apps/{id}:
     *   get:
     *     summary: Get an application by ID
     *     tags:
     *       - Apps
     *     description: |
     *       Retrieves the application with the specified ID.
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: integer
     *         description: Application ID
     *     responses:
     *       200:
     *         description: Application retrieved successfully
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
     *                     id:
     *                       type: integer
     *                       example: 1
     *                     name:
     *                       type: string
     *                       example: "Homework Helper"
     *                     description:
     *                       type: string
     *                       example: "An app to assist students with homework"
     *                     ownerId:
     *                       type: integer
     *                       example: 42
     *       404:
     *         description: Application not found
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: false
     *                 message:
     *                   type: string
     *                   example: Application not found.
     */
    router.get("/apps/:id", async (req, res) => {
        const { id } = req.params;
        requireParam(id, "id");

        const appId = Number(id);
        if (!Number.isInteger(appId) || appId <= 0) {
            throw new ValidationError("Invalid App Id", { reason: "invalid_app_id", event: "app.get.failed" });
        }

        const app = await appService.getAppById(appId);
        if (!app) {
            return res.status(404).json({ success: false, message: "Application not found." });
        }

        res.json({ success: true, data: app });
    });
};
