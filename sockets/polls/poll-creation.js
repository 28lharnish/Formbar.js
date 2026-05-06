const { classStateStore } = require("@services/classroom-service");
const { createPoll } = require("@services/poll-service");
const { handleSocketError } = require("@modules/socket-error-handler");
const { SCOPES } = require("@modules/permissions");
const { onSocketEvent, hasClassScope } = require("@modules/socket-event-middleware");

module.exports = {
    run(socket, socketUpdates) {
        // Starts a poll with the data provided
        onSocketEvent(socket, "startPoll", hasClassScope(SCOPES.CLASS.POLL.CREATE), async (socketContext, ...args) => {
            try {
                const classId = await socketContext.resolveClassId();

                // Support both passing a single object or multiple arguments for backward compatibility
                let pollData;
                if (args.length == 1) {
                    pollData = args[0];
                } else {
                    const [
                        responseNumber,
                        responseTextBox,
                        pollPrompt,
                        polls,
                        blind,
                        weight,
                        boxes,
                        indeterminate,
                        lastResponse,
                        multiRes,
                        allowVoteChanges,
                    ] = args;
                    pollData = {
                        prompt: pollPrompt,
                        answers: Array.isArray(polls) ? polls : [],
                        blind: !!blind,
                        allowVoteChanges: !!allowVoteChanges,
                        allowTextResponses: !!responseTextBox,
                        allowMultipleResponses: !!multiRes,
                        weight: Number(weight ?? 1),
                        indeterminate: Array.isArray(indeterminate) ? indeterminate : [],
                        excludedRespondents: Array.isArray(boxes) ? boxes : [],
                    };
                }

                await createPoll(
                    classId,
                    {
                        prompt: pollData.prompt,
                        answers: Array.isArray(pollData.answers) ? pollData.answers : [],
                        blind: !!pollData.blind,
                        allowVoteChanges: !!pollData.allowVoteChanges,
                        allowTextResponses: !!pollData.allowTextResponses,
                        allowMultipleResponses: !!pollData.allowMultipleResponses,
                        weight: Number(pollData.weight ?? 1),
                        excludedRespondents: Array.isArray(pollData.excludedRespondents) ? pollData.excludedRespondents : [],
                        indeterminate: Array.isArray(pollData.indeterminate) ? pollData.indeterminate : [],
                    },
                    socketContext.session
                );
                socket.emit("startPoll");
            } catch (err) {
                handleSocketError(err, socket, "startPoll");
            }
        });
    },
};
