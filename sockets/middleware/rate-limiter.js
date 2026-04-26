const { PASSIVE_SOCKETS } = require("@services/socket-updates-service");
const { computeGlobalPermissionLevel, TEACHER_PERMISSIONS } = require("@modules/permissions");
const { handleSocketError } = require("@modules/socket-error-handler");
const { socketStateStore } = require("@stores/socket-state-store");
const { classStateStore } = require("@services/classroom-service");
const { getUserDataFromDb } = require("@services/user-service");
const { dbGet } = require("@modules/database");
const { getUserScopes } = require("@modules/scope-resolver");

/**
 * Resolve the socket user from cache, session state, or the database.
 *
 * @param {import("socket.io").Socket} socket - socket.
 * @param {*} email - email.
 * @returns {Promise<*>}
 */
async function getSocketUserData(socket, email) {
    const cachedUser = classStateStore.getUser(email);
    if (cachedUser) {
        return cachedUser;
    }

    const sessionUserId = socket.request.session?.userId;
    if (sessionUserId != null) {
        return getUserDataFromDb(sessionUserId);
    }

    if (!email) {
        return null;
    }

    const userRow = await dbGet("SELECT id FROM users WHERE email = ?", [email]);
    return userRow ? getUserDataFromDb(userRow.id) : null;
}

module.exports = {
    order: 0,
    run(socket, socketUpdates) {
        // Rate limiter
        socket.use(async ([event, ...args], next) => {
            try {
                if (!socket.request.session) {
                    return next();
                }

                const email = socket.request.session.email;
                if (!email) {
                    return next();
                }

                const userData = await getSocketUserData(socket, email);
                const currentTime = Date.now();
                const timeFrame = 1000; // 1 Second
                const limit =
                    computeGlobalPermissionLevel(getUserScopes(userData || socket.request.session).global) >= TEACHER_PERMISSIONS ? 100 : 30;
                const identifier = String(userData?.id ?? socket.request.session.userId ?? email ?? socket.id);
                const userRequests = socketStateStore.getUserRateLimits(identifier, true);
                userRequests[event] = userRequests[event] || [];
                while (userRequests[event].length && currentTime - userRequests[event][0] > timeFrame) {
                    userRequests[event].shift();
                    userRequests["hasBeenMessaged"] = false;
                }

                if (userRequests[event].length >= limit) {
                    if (!userRequests["hasBeenMessaged"] && !PASSIVE_SOCKETS.includes(event)) {
                        socket.emit("message", `You are being rate limited. Please try again in ${timeFrame / 1000} seconds.`);
                    }
                    userRequests["hasBeenMessaged"] = true;
                } else {
                    userRequests[event].push(currentTime);
                    next();
                }
            } catch (err) {
                handleSocketError(err, socket, "rate-limiter-middleware");
                next(err);
            }
        });
    },
};
