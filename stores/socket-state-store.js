/**
 * SocketStateStore
 * Central in-memory store for socket-related runtime state.
 */
class SocketStateStore {
    constructor() {
        this._state = {
            runningTimers: {},
            rateLimits: {},
            userSockets: {},
            lastActivities: {},
        };
    }

    // -------------------------------------------------------------------------
    // Raw state access
    // -------------------------------------------------------------------------

    /**
     * Return the backing socket state object for debugging and snapshotting.
     *
     * @returns {*}
     */
    getRawState() {
        return this._state;
    }

    // -------------------------------------------------------------------------
    // Running timers
    // -------------------------------------------------------------------------

    /**
     * Return every active timer handle keyed by class ID.
     *
     * @returns {*}
     */
    getRunningTimers() {
        return this._state.runningTimers;
    }

    /**
     * Return the active timer handle for one class, if it exists.
     *
     * @param {*} classId - classId.
     * @returns {*}
     */
    getRunningTimer(classId) {
        return this._state.runningTimers[classId];
    }

    /**
     * Store a timer handle for one class so it can be cleared later.
     *
     * @param {*} classId - classId.
     * @param {*} timerHandle - timerHandle.
     * @returns {*}
     */
    setRunningTimer(classId, timerHandle) {
        this._state.runningTimers[classId] = timerHandle;
    }

    /**
     * Clear Running Timer.
     *
     * @param {*} classId - classId.
     * @param {*} shouldClearInterval - shouldClearInterval.
     * @returns {*}
     */
    clearRunningTimer(classId, shouldClearInterval = true) {
        const timerHandle = this._state.runningTimers[classId];
        if (shouldClearInterval && timerHandle) {
            clearInterval(timerHandle);
        }
        this._state.runningTimers[classId] = null;
    }

    // -------------------------------------------------------------------------
    // Rate limits
    // -------------------------------------------------------------------------

    /**
     * Return the in-memory rate-limit buckets grouped by user.
     *
     * @returns {*}
     */
    getRateLimits() {
        return this._state.rateLimits;
    }

    /**
     * Return or create the rate-limit bucket for a specific user.
     *
     * @param {*} email - email.
     * @param {*} create - create.
     * @returns {*}
     */
    getUserRateLimits(email, create = false) {
        if (create && !this._state.rateLimits[email]) {
            this._state.rateLimits[email] = {};
        }
        return this._state.rateLimits[email];
    }

    /**
     * Remove all rate-limit history for one user.
     *
     * @param {*} email - email.
     * @returns {*}
     */
    clearUserRateLimits(email) {
        delete this._state.rateLimits[email];
    }

    // -------------------------------------------------------------------------
    // Connected sockets by email
    // -------------------------------------------------------------------------

    /**
     * Return every connected socket grouped by user email.
     *
     * @returns {*}
     */
    getUserSockets() {
        return this._state.userSockets;
    }

    /**
     * Return the sockets currently associated with one email address.
     *
     * @param {*} email - email.
     * @returns {*}
     */
    getUserSocketsByEmail(email) {
        return this._state.userSockets[email];
    }

    /**
     * Track a newly connected socket for a user.
     *
     * @param {*} email - email.
     * @param {*} socketId - socketId.
     * @param {import("socket.io").Socket} socket - socket.
     * @returns {*}
     */
    setUserSocket(email, socketId, socket) {
        if (!this._state.userSockets[email]) {
            this._state.userSockets[email] = {};
        }
        this._state.userSockets[email][socketId] = socket;
    }

    /**
     * Remove one tracked socket and report whether the user bucket is empty.
     *
     * @param {*} email - email.
     * @param {*} socketId - socketId.
     * @returns {*}
     */
    removeUserSocket(email, socketId) {
        if (!this._state.userSockets[email]) {
            return { existed: false, emptyAfterRemoval: true };
        }

        const existed = !!this._state.userSockets[email][socketId];
        delete this._state.userSockets[email][socketId];

        const emptyAfterRemoval = Object.keys(this._state.userSockets[email]).length === 0;
        if (emptyAfterRemoval) {
            delete this._state.userSockets[email];
        }

        return { existed, emptyAfterRemoval };
    }

    /**
     * Check whether a user still has any live sockets.
     *
     * @param {*} email - email.
     * @returns {boolean}
     */
    hasUserSockets(email) {
        const sockets = this._state.userSockets[email];
        return !!(sockets && Object.keys(sockets).length > 0);
    }

    // -------------------------------------------------------------------------
    // Inactivity tracking
    // -------------------------------------------------------------------------

    /**
     * Return the last-activity map used for presence and cleanup tracking.
     *
     * @returns {*}
     */
    getLastActivities() {
        return this._state.lastActivities;
    }

    /**
     * Return the tracked activity entries for one user.
     *
     * @param {*} email - email.
     * @returns {*}
     */
    getUserLastActivities(email) {
        return this._state.lastActivities[email];
    }

    /**
     * Record the latest activity timestamp for one socket connection.
     *
     * @param {*} email - email.
     * @param {*} socketId - socketId.
     * @param {import("socket.io").Socket} socket - socket.
     * @param {*} time - time.
     * @returns {*}
     */
    touchLastActivity(email, socketId, socket, time = Date.now()) {
        if (!this._state.lastActivities[email]) {
            this._state.lastActivities[email] = {};
        }
        this._state.lastActivities[email][socketId] = { socket, time };
    }

    /**
     * Remove one socket's activity entry and clean up empty user buckets.
     *
     * @param {*} email - email.
     * @param {*} socketId - socketId.
     * @returns {*}
     */
    removeLastActivity(email, socketId) {
        if (!this._state.lastActivities[email]) return;

        delete this._state.lastActivities[email][socketId];
        if (Object.keys(this._state.lastActivities[email]).length === 0) {
            delete this._state.lastActivities[email];
        }
    }

    /**
     * Remove all tracked activity entries for a user.
     *
     * @param {*} email - email.
     * @returns {*}
     */
    clearUserLastActivities(email) {
        delete this._state.lastActivities[email];
    }
}

const socketStateStore = new SocketStateStore();

module.exports = {
    SocketStateStore,
    socketStateStore,
};
