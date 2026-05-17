const { saveUserPollTemplate, getUserPollTemplates } = require("@services/poll-service");
const { isOwnerOrHasScopes } = require("@middleware/permission-check");
const { parseJson } = require("@middleware/parse-json");
const { SCOPES } = require("@modules/permissions");
const { isAuthenticated } = require("@middleware/authentication");
const membershipService = require("@services/class-membership-service");

/**
 * Register save-template controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/polls/templates/user:
     *   get:
     *     summary: Get saved poll templates in My Polls
     *     tags:
     *       - Class - Polls
     *     description: |
     *       Returns poll templates owned by, shared with, or marked public for the current user.
     *
     *       **Required Permission:** `class.poll.create`
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
     *         description: Poll templates retrieved
     *       403:
     *         description: Insufficient permissions
     */
    router.get(
        "/class/:id/polls/templates/user",
        isAuthenticated,
        isOwnerOrHasScopes(
            membershipService.classroomOwnerCheck,
            SCOPES.CLASS.POLL.CREATE,
            "You don't have permission to view saved polls for this class."
        ),
        async (req, res) => {
            const classId = req.params.id;
            const userId = req.user.userId ?? req.user.id;

            req.infoEvent("class.poll.template.list.attempt", "Attempting to list user poll templates", { classId });

            const polls = await getUserPollTemplates(userId);

            req.infoEvent("class.poll.template.list.success", "User poll templates returned", {
                classId,
                pollCount: polls.length,
            });

            res.status(200).json({
                success: true,
                data: { polls },
            });
        }
    );

    /**
     * @swagger
     * /api/v1/class/{id}/polls/templates:
     *   post:
     *     summary: Save a poll template to My Polls
     *     tags:
     *       - Class - Polls
     *     description: |
     *       Saves the poll editor configuration as a reusable custom poll owned by the current user.
     *
     *       **Required Permission:** `class.poll.create`
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
     *               - prompt
     *               - answers
     *             properties:
     *               name:
     *                 type: string
     *                 example: "Unit 3 Review"
     *               prompt:
     *                 type: string
     *                 example: "Which answer is correct?"
     *               answers:
     *                 type: array
     *                 items:
     *                   type: object
     *               allowTextResponses:
     *                 type: boolean
     *               blind:
     *                 type: boolean
     *               allowVoteChanges:
     *                 type: boolean
     *               allowMultipleResponses:
     *                 type: boolean
     *               weight:
     *                 type: number
     *               public:
     *                 type: boolean
     *     responses:
     *       200:
     *         description: Poll template saved
     *       403:
     *         description: Insufficient permissions
     */
    router.post(
        "/class/:id/polls/templates/user",
        isAuthenticated,
        isOwnerOrHasScopes(
            membershipService.classroomOwnerCheck,
            SCOPES.CLASS.POLL.CREATE,
            "You don't have permission to save polls for this class."
        ),
        parseJson,
        async (req, res) => {
            const classId = req.params.id;
            req.infoEvent("class.poll.template.save.attempt", "Attempting to save poll template", { classId });

            const result = await saveUserPollTemplate(classId, req.body || {}, req.user);

            req.infoEvent("class.poll.template.save.success", "Poll template saved", {
                classId,
                pollId: result.pollId,
            });

            res.status(200).json({
                success: true,
                data: result,
            });
        }
    );
};
