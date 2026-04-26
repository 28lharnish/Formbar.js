/**
 * Backwards Compatibility Socket Handlers
 *
 * Supports auxiliary applications built against the old Formbar API.
 * Each handler normalizes the legacy call pattern to the current API, and
 * emits a deprecation warning so developers know to migrate.
 */

const { verifyToken } = require("@services/auth-service");
const { getUserDataFromDb } = require("@services/user-service");
const { resolveAPIKey } = require("@services/api-key-service");
const { handleSocketError } = require("@modules/socket-error-handler");
const { finalizeAuthentication } = require("./middleware/api");

const DEPRECATION_NOTICE =
    "Deprecated authentication method used. Please update to use header-based authentication. " + "See the Formbar.js API documentation for details.";

module.exports = {
    run(socket, socketUpdates) {
        /**
         * formPix backwards compatibility.
         *
         * Old behaviour: the client emits `getActiveClass` with a raw API key string;
         *   the server responds with `setClass`.
         * New behaviour: pass the API key in the `api` request header when connecting.
         */
        socket.on("getActiveClass", async (apiKey) => {
            try {
                // Already authenticated — just echo back the current class
                if (socket.request.session.email) {
                    socket.emit("setClass", socket.request.session.classId);
                    return;
                }

                if (typeof apiKey !== "string" || !apiKey) {
                    return socket.emit("error", "Invalid API key format.");
                }

                const apiKeyUser = await resolveAPIKey(apiKey);
                if (!apiKeyUser) {
                    return socket.emit("error", "Invalid API key.");
                }

                const userData = await getUserDataFromDb(apiKeyUser.id);
                finalizeAuthentication(socket, userData, socketUpdates, true);

                socket.emit("deprecationWarning", {
                    message: DEPRECATION_NOTICE,
                    event: "getActiveClass",
                    recommendation: "Pass your API key in the `api` request header when connecting to the socket.",
                });
            } catch (err) {
                handleSocketError(err, socket, "getActiveClass");
            }
        });

        /**
         * jukebar backwards compatibility.
         *
         * Old behaviour: the client emits `auth` with `{ token: <JWT> }`; the server
         *   responds with `setClass`.
         * New behaviour: pass the access token in the `authorization` request header when connecting.
         */
        socket.on("auth", async (data) => {
            try {
                // Already authenticated — just echo back the current class
                if (socket.request.session.email) {
                    socket.emit("setClass", socket.request.session.classId);
                    return;
                }

                const token = data && data.token;
                if (!token || typeof token !== "string") {
                    return socket.emit("error", "Missing or invalid authentication token.");
                }

                const decodedToken = verifyToken(token);
                if (decodedToken.error) {
                    return socket.emit("error", "Invalid access token.");
                }

                const { email, id: userId } = decodedToken;
                if (!email || !userId) {
                    return socket.emit("error", "Invalid access token: missing required fields.");
                }

                const userData = await getUserDataFromDb(userId);
                if (!userData) {
                    return socket.emit("error", "User not found.");
                }

                finalizeAuthentication(socket, userData, socketUpdates, false);

                socket.emit("deprecationWarning", {
                    message: DEPRECATION_NOTICE,
                    event: "auth",
                    recommendation: "Pass your access token in the `authorization` request header when connecting to the socket.",
                });
            } catch (err) {
                handleSocketError(err, socket, "auth");
            }
        });

        /**
         * General backwards compatibility (formPix + jukebar).
         *
         * Old behaviour: the client emits `getClassroom` to request the current classroom
         *   state; the server responds with a `classUpdate` event.
         * New behaviour: the server automatically emits `classUpdate` whenever the class
         *   state changes, but `getClassroom` is still supported for an explicit pull.
         */
        socket.on("getClassroom", () => {
            try {
                socketUpdates.classUpdate(socket.request.session.classId, { global: false });
            } catch (err) {
                handleSocketError(err, socket, "getClassroom");
            }
        });
    },
};
