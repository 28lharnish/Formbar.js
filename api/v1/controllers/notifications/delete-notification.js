const { deleteNotification, emptyInboxForUser, getNotificationById } = require("@services/notification-service");
const { isAuthenticated } = require("@middleware/authentication");
const NotFoundError = require("@errors/not-found-error");

/**
 * Register delete-notification controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/notifications:
     *   delete:
     *     summary: Delete all notifications for the authenticated user
     *     tags:
     *       - Notifications
     *     description: |
     *       Permanently deletes all notifications belonging to the currently authenticated user.
     *
     *       **Required Permission:** Authenticated user
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     responses:
     *       200:
     *         description: Inbox emptied successfully
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
     *       401:
     *         description: Unauthorized â€“ user is not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     */
    router.delete("/notifications/", isAuthenticated, async (req, res) => {
        req.infoEvent("notifications.delete.attempt", "User is attempting to empty their inbox");

        await emptyInboxForUser(req.user.id);

        req.infoEvent("notifications.delete.success", "Inbox emptied successfully");

        res.json({
            success: true,
            data: {},
        });
    });

    /**
     * @swagger
     * /api/v1/notifications/{id}:
     *   delete:
     *     summary: Delete a notification by ID
     *     tags:
     *       - Notifications
     *     description: |
     *       Permanently deletes a notification by its ID. The notification must belong to
     *       the authenticated user. A 404 is returned if the notification does not exist or
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
     *         description: The ID of the notification to delete
     *         schema:
     *           type: string
     *           example: "42"
     *     responses:
     *       200:
     *         description: Notification deleted successfully
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
    router.delete("/notifications/:id", isAuthenticated, async (req, res) => {
        const notificationId = req.params.id;

        req.infoEvent("notifications.delete.attempt", "User is attempting to delete a notification");

        const notification = await getNotificationById(notificationId);

        if (!notification) {
            throw new NotFoundError("Notification not found", {
                event: "notifications.delete.failed",
                reason: "Notification not found",
                notificationId,
            });
        }

        if (notification.user_id !== req.user.id) {
            // If the notification does not belong to the user, return NotFoundError to avoid leaking information about the existence of the notification
            throw new NotFoundError("Notification not found", {
                event: "notifications.delete.failed",
                reason: "Notification does not belong to user",
                notificationId,
            });
        }

        await deleteNotification(notificationId);

        req.infoEvent("notifications.delete.success", "Notification deleted successfully");

        res.json({
            success: true,
            data: {},
        });
    });
};
