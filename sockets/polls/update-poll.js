const { updatePoll } = require("@services/poll-service");
const { SCOPES } = require("@modules/permissions");
const { onSocketEvent, hasClassScope } = require("@modules/socket-event-middleware");
const ValidationError = require("@errors/validation-error");

module.exports = {
    run(socket, socketUpdates) {
        /**
         * Updates poll properties dynamically
         * @param {Object} options - Poll properties to update
         *
         * Examples:
         * socket.emit("updatePoll", {status: false}); // Ends poll
         * socket.emit("updatePoll", {excludedRespondents: [1, 2]}); // Changes who can vote
         * socket.emit("updatePoll", {blind: true}); // Makes poll blind
         * socket.emit("updatePoll", {}); // Clears the entire poll
         */
        onSocketEvent(socket, "updatePoll", hasClassScope(SCOPES.CLASS.POLL.CREATE), async (socketContext, options) => {
            const classId = await socketContext.resolveClassId();
            if (!options || typeof options !== "object" || Array.isArray(options)) {
                throw new ValidationError("Invalid poll update options");
            }

            await updatePoll(classId, options, socketContext.session);
        });
    },
};
