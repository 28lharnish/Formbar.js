const { sendHelpTicket, deleteHelpTicket } = require("@services/class-service");
const { SCOPES } = require("@modules/permissions");
const { onSocketEvent, hasClassScope } = require("@modules/socket-event-middleware");

module.exports = {
    run(socket, socketUpdates) {
        // Sends a help ticket
        onSocketEvent(socket, "help", hasClassScope(SCOPES.CLASS.HELP.REQUEST), async (socketContext, reason) => {
            const result = await sendHelpTicket(reason, socketContext.session);
            if (result !== true) {
                socket.emit("message", result);
            }
        });

        // Deletes help ticket
        onSocketEvent(socket, "deleteTicket", hasClassScope(SCOPES.CLASS.HELP.APPROVE), async (socketContext, studentId) => {
            await deleteHelpTicket(studentId, socketContext.session);
        });
    },
};
