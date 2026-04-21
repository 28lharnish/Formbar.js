const { getNotificationById, markNotificationAsRead } = require("@services/notification-service");
const { isAuthenticated } = require("@middleware/authentication");
const NotFoundError = require("@errors/not-found-error");
const ValidationError = require("@errors/validation-error");

/**
 * * Register mark-notification-read controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/notifications/{id}/mark-read:
     *   post:
     *     summary: Mark a notification as read
     *     tags:
     *       - Notifications
     *     description: |
     *       Marks a specific notification as read. The notification must belong to the
     *       authenticated user. A 404 is returned if the notification does not exist or
     *       belongs to a different user (to avoid leaking information about other users'
     *       notifications).
     *
     *       **Required Permission:** Authenticated user
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         description: The ID of the notification to mark as read
     *         schema:
     *           type: string
     *           example: "42"
     *     responses:
     *       200:
     *         description: Notification marked as read successfully
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
     *                     notification:
     *                       $ref: '#/components/schemas/Notification'
     *       400:
     *         description: Bad request – notification ID not provided
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: Unauthorized – user is not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       404:
     *         description: Notification not found or does not belong to the authenticated user
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.post("/notifications/:id/mark-read", isAuthenticated, async (req, res) => {
        const notificationId = req.params.id;

        if (!notificationId) {
            throw new ValidationError("Notification ID is required", { event: "notifications.get.failed", reason: "Notification ID not provided" });
        }

        req.infoEvent("notifications.mark_as_read.attempt", "User is attempting to mark a notification as read", { notificationId });

        const notification = await getNotificationById(notificationId);

        if (!notification) {
            throw new NotFoundError("Notification not found", { event: "notifications.mark_as_read.failed", reason: "Notification not found" });
        }

        if (notification.user_id !== req.user.id) {
            // If the notification does not belong to the user, return NotFoundError to avoid leaking information about the existence of the notification
            throw new NotFoundError("Notification not found", {
                event: "notifications.mark_as_read.failed",
                reason: "Notification does not belong to user",
                notificationId,
            });
        }

        await markNotificationAsRead(notificationId);
        notification.is_read = 1;

        req.infoEvent("notifications.mark_as_read.success", "Notification marked as read successfully");

        res.json({
            success: true,
            data: { notification },
        });
    });
};
