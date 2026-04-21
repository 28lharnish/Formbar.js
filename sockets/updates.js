const { SCOPES } = require("@modules/permissions");
const { onSocketEvent, hasClassScope } = require("@modules/socket-event-middleware");

module.exports = {
    run(socket, socketUpdates) {
        socket.on("classUpdate", () => {
            socketUpdates.classUpdate(socket.request.session.classId, { global: false });
        });

        onSocketEvent(socket, "customPollUpdate", hasClassScope(SCOPES.CLASS.POLL.CREATE), async (socketContext) => {
            socketUpdates.customPollUpdate(socketContext.session.email);
        });

        onSocketEvent(socket, "classBannedUsersUpdate", hasClassScope(SCOPES.CLASS.STUDENTS.BAN), async () => {
            socketUpdates.classBannedUsersUpdate();
        });
    },
};
