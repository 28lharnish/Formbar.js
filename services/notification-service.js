const { dbGet, dbGetAll, dbRun } = require("@modules/database");

/**
 * * Get a notification by ID.
 * @param {Object} notificationId - notificationId.
 * @returns {Promise<Object|null>}
 */
async function getNotificationById(notificationId) {
    const notification = await dbGet("SELECT * FROM notifications WHERE id = ?", [notificationId]);
    return notification;
}

/**
 * * Get notifications for a user.
 * @param {number} userId - userId.
 * @returns {Promise<Object[]>}
 */
async function getNotificationsForUser(userId) {
    const notifications = await dbGetAll("SELECT * FROM notifications WHERE user_id = ?", [userId]);
    return notifications;
}

/**
 * * Mark a notification as read.
 * @param {Object} notificationId - notificationId.
 * @returns {Promise<void>}
 */
async function markNotificationAsRead(notificationId) {
    await dbRun("UPDATE notifications SET is_read = 1 WHERE id = ?", [notificationId]);
}

/**
 * * Create a notification.
 * @param {number} userId - userId.
 * @param {string} type - type.
 * @param {Object} data - data.
 * @returns {Promise<number>}
 */
async function createNotification(userId, type, data) {
    await dbRun("INSERT INTO notifications (user_id, type, data) VALUES (?, ?, ?)", [userId, type, JSON.stringify(data)]);
}

/**
 * * Delete a notification.
 * @param {Object} notificationId - notificationId.
 * @returns {Promise<void>}
 */
async function deleteNotification(notificationId) {
    await dbRun("DELETE FROM notifications WHERE id = ?", [notificationId]);
}

/**
 * * Delete all notifications for a user.
 * @param {number} userId - userId.
 * @returns {Promise<void>}
 */
async function emptyInboxForUser(userId) {
    await dbRun("DELETE FROM notifications WHERE user_id = ?", [userId]);
}

module.exports = {
    getNotificationById,
    getNotificationsForUser,
    markNotificationAsRead,
    createNotification,
    emptyInboxForUser,
    deleteNotification,
};
