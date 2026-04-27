const { getNotificationsForUserPaginated, getNotificationById } = require("@services/notification-service");
const { isAuthenticated } = require("@middleware/authentication");
const { buildPagination, parsePaginationQuery } = require("@modules/pagination");
const AppError = require("@errors/app-error");
const NotFoundError = require("@errors/not-found-error");
const ValidationError = require("@errors/validation-error");

const DEFAULT_NOTIFICATION_LIMIT = 20;
const MAX_NOTIFICATION_LIMIT = 100;

/**
 * Register get-notifications controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/notifications:
     *   get:
     *     summary: Get all notifications for the authenticated user
     *     tags:
     *       - Notifications
     *     description: |
     *       Returns paginated notifications belonging to the currently authenticated user.
     *
     *       **Required Permission:** Authenticated user
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: query
     *         name: limit
     *         required: false
     *         schema:
     *           type: integer
     *           default: 20
     *           minimum: 1
     *           maximum: 100
     *         description: Number of notifications to return per page
     *       - in: query
     *         name: offset
     *         required: false
     *         schema:
     *           type: integer
     *           default: 0
     *           minimum: 0
     *         description: Number of notifications to skip before returning results
     *     responses:
     *       200:
     *         description: Notifications retrieved successfully
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
     *                     notifications:
     *                       type: array
     *                       items:
     *                         $ref: '#/components/schemas/Notification'
     *                     pagination:
     *                       type: object
     *                       properties:
     *                         total:
     *                           type: integer
     *                         limit:
     *                           type: integer
     *                         offset:
     *                           type: integer
     *                         hasMore:
     *                           type: boolean
     *       401:
     *         description: Unauthorized – user is not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.get("/notifications", isAuthenticated, async (req, res) => {
        req.infoEvent("notifications.get_user_notifications.attempt", "User is attempting to fetch all their notifications");

        const { limit, offset } = parsePaginationQuery(req.query, DEFAULT_NOTIFICATION_LIMIT, MAX_NOTIFICATION_LIMIT);
        const { notifications, total } = await getNotificationsForUserPaginated(req.user.id, limit, offset);

        if (!notifications) {
            throw new AppError("Failed to fetch notifications", { event: "notifications.get_user_notifications.failed" });
        }

        res.json({
            success: true,
            data: {
                notifications,
                pagination: buildPagination(total, limit, offset, notifications.length),
            },
        });
    });

    /**
     * @swagger
     * /api/v1/notifications/{id}:
     *   get:
     *     summary: Get a specific notification by ID
     *     tags:
     *       - Notifications
     *     description: |
     *       Returns a single notification by its ID. The notification must belong to the
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
     *         description: The ID of the notification to retrieve
     *         schema:
     *           type: string
     *           example: "42"
     *     responses:
     *       200:
     *         description: Notification retrieved successfully
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
    router.get("/notifications/:id", isAuthenticated, async (req, res) => {
        const notificationId = req.params.id;

        if (!notificationId) {
            throw new ValidationError("Notification ID is required", { event: "notifications.get.failed", reason: "Notification ID not provided" });
        }

        req.infoEvent("notifications.get.attempt", "User is attempting to fetch a specific notification", { notificationId });

        const notification = await getNotificationById(notificationId);

        if (!notification) {
            throw new NotFoundError("Notification not found", { event: "notifications.get.failed", reason: "Notification not found" });
        }

        if (notification.user_id !== req.user.id) {
            // If the notification does not belong to the user, return NotFoundError to avoid leaking information about the existence of the notification
            throw new NotFoundError("Notification not found", {
                event: "notifications.get.failed",
                reason: "Notification does not belong to user",
                notificationId,
            });
        }

        res.json({
            success: true,
            data: { notification },
        });
    });
};
