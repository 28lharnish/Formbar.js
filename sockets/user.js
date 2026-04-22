const { logout } = require("@services/user-service");
const { handleSocketError } = require("@modules/socket-error-handler");
const { SCOPES } = require("@modules/permissions");
const { onSocketEvent, hasScope } = require("@modules/socket-event-middleware");

module.exports = {
    run(socket, socketUpdates) {
        onSocketEvent(socket, "getOwnedClasses", hasScope(SCOPES.GLOBAL.CLASS.CREATE), async (socketContext, email) => {
            socketUpdates.getOwnedClasses(email);
        });

        socket.on("logout", () => {
            try {
                logout(socket);
            } catch (err) {
                handleSocketError(err, socket, "logout");
            }
        });
    },
};
