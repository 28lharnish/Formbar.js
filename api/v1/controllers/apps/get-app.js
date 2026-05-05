const { isAuthenticated } = require("@middleware/authentication");
const ValidationError = require("@errors/validation-error");
const appService = require("@services/app-service");
const { requireQueryParam } = require("@modules/error-wrapper");

module.exports = (router) => {
	/**
	 * @swagger
	 * /api/v1/apps:
	 *   get:
	 *     summary: Get all applications owned by the authenticated user
	 *    tags:
	 * 	 - Apps
	 *    description: |
	 * 	 Retrieves a list of all third-party applications owned by the authenticated user, including their app id, name and description.
	 *    security:
	 * 	- bearerAuth: []
	 * 	- apiKeyAuth: []
	 *    responses:
	 *      200:
	 * 	  description: Applications retrieved successfully
	 * 	  content:
	 * 	    application/json:
	 * 	      schema:
	 * 		type: object
	 * 	properties:
	 * 	success:
	 * 	  type: boolean
	 * 	  example: true
	 * 	data:
	 * 	  type: array
	 * 	  items:
	 * 	    type: object
	 * 	    properties:
	 * 	      appId:
	 * 	      type: integer
	 * 	      example: 1
	 * 	      name:
	 * 	      type: string
	 * 	      example: "Homework Helper"
	 * 	      description:
	 * 	      type: string
	 * 	      example: "An app to assist students with homework"
	 */
	router.get("/apps/:id", async (req, res) => {
        const appId = req.params.id;
		requireQueryParam(appId, "id");

		try {
			const app = await appService.getAppById(appId);
			if(!app) {
				return res.status(404).json({ success: false, message: "Application not found." });
			}
			res.json({ success: true, data: app });
		}
		catch (error) {
			console.error("Error fetching app:", error);
			res.status(500).json({ success: false, message: "An error occurred while fetching the application." });
		}
	});
}