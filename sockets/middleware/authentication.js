const { resolveAPIKey } = require("@services/api-key-service");
const { classStateStore } = require("@services/classroom-service");
const authService = require("@services/auth-service");

const { handleSocketError } = require("@modules/socket-error-handler");

// Legacy bootstrap events that must be allowed through before a session is
// established — they ARE the authentication mechanism for old API clients.
const LEGACY_AUTH_EVENTS = new Set(["getActiveClass", "auth"]);

module.exports = {
    order: 20,
    run(socket, socketUpdates) {
        // Authentication for users and plugins to connect to formbar websockets
        // The user must be logged in order to connect to websockets
        socket.use(([event, ...args], next) => {
            try {
                // Allow legacy backwards-compat events to reach their handlers
                // so those handlers can establish a session before this middleware
                // would otherwise reject them.
                if (LEGACY_AUTH_EVENTS.has(event)) {
                    next();
                    return;
                }

                let { api, authorization } = socket.request.headers;

                if (socket.request.session.email) {
                    next();
                } else if (authorization) {
                    // Try to authenticate using access token (JWT)
                    const decodedToken = authService.verifyToken(authorization);
                    if (decodedToken.error) {
                        next(new Error("Invalid access token"));
                        return;
                    }

                    const email = decodedToken.email;
                    if (!email) {
                        next(new Error("Invalid access token - missing email"));
                        return;
                    }

                    const user = classStateStore.getUser(email);
                    if (!user) {
                        next(new Error("User not found"));
                        return;
                    }

                    // Set session information from the access token
                    socket.request.session.email = email;
                    socket.request.session.userId = user.id;
                    socket.request.session.displayName = user.displayName;
                    socket.request.session.verified = user.verified;
                    socket.request.session.tags = user.tags;
                    socket.request.session.classId = user.activeClass || null;

                    next();
                } else if (api) {
                    resolveAPIKey(api)
                        .then((matchedUser) => {
                            if (!matchedUser) {
                                next(new Error("Not a valid API key"));
                                return;
                            }

                            socket.request.session.api = matchedUser.API;
                            socket.request.session.userId = matchedUser.id;
                            socket.request.session.email = matchedUser.email;
                            socket.request.session.classId = null;

                            next();
                        })
                        .catch((err) => {
                            handleSocketError(err, socket, "authentication:api");
                            next(err);
                        });
                } else {
                    next(new Error("Missing authentication credentials"));
                }
            } catch (err) {
                handleSocketError(err, socket, "authentication");
                next(err);
            }
        });
    },
};
