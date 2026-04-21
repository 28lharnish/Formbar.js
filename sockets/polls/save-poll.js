const { classStateStore } = require("@services/classroom-service");
const { database } = require("@modules/database");
const { handleSocketError } = require("@modules/socket-error-handler");
const { socketStateStore } = require("@stores/socket-state-store");
const { SCOPES } = require("@modules/permissions");
const { onSocketEvent, hasClassScope } = require("@modules/socket-event-middleware");

module.exports = {
    run(socket, socketUpdates) {
        onSocketEvent(socket, "classPoll", hasClassScope(SCOPES.CLASS.POLL.CREATE), async (socketContext, poll) => {
            try {
                let userId = socketContext.session.userId;
                database.get('SELECT seq AS nextPollId from sqlite_sequence WHERE name = "custom_polls"', (err, nextPollId) => {
                    try {
                        if (err) throw err;

                        nextPollId = nextPollId.nextPollId + 1;

                        database.run(
                            "INSERT INTO custom_polls (owner, name, prompt, answers, textRes, blind, allowVoteChanges, allowMultipleResponses, weight, public) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            [
                                userId,
                                poll.name,
                                poll.prompt,
                                JSON.stringify(poll.answers),
                                poll.textRes,
                                poll.blind,
                                poll.allowVoteChanges,
                                poll.allowMultipleResponses,
                                poll.weight,
                                poll.public,
                            ],
                            (err) => {
                                try {
                                    if (err) throw err;

                                    classStateStore.updateClassroomStudent(socketContext.session.classId, socketContext.session.email, (student) => {
                                        if (!Array.isArray(student.ownedPolls)) {
                                            student.ownedPolls = [];
                                        }
                                        student.ownedPolls.push(nextPollId);
                                    });
                                    socket.emit("message", "Poll saved successfully!");
                                    socketUpdates.customPollUpdate(socketContext.session.email);
                                    socket.emit("classPollSave", nextPollId);
                                } catch (err) {
                                    handleSocketError(err, socket, "classPoll:dbRun");
                                }
                            }
                        );
                    } catch (err) {
                        handleSocketError(err, socket, "classPoll:dbGet:sqlite_sequence");
                    }
                });
            } catch (err) {
                handleSocketError(err, socket, "classPoll");
            }
        });

        onSocketEvent(socket, "savePoll", hasClassScope(SCOPES.CLASS.POLL.CREATE), async (socketContext, poll, pollId) => {
            try {
                const userId = socketContext.session.userId;
                if (pollId) {
                    database.get("SELECT * FROM custom_polls WHERE id=?", [pollId], (err, poll) => {
                        try {
                            if (err) throw err;

                            if (userId != poll.owner) {
                                socket.emit("message", "You do not have permission to edit this poll.");
                                return;
                            }

                            database.run(
                                "UPDATE custom_polls SET name=?, prompt=?, answers=?, textRes=?, blind=?, allowVoteChanges=?, allowMultipleResponses=?, weight=?, public=? WHERE id=?",
                                [
                                    poll.name,
                                    poll.prompt,
                                    JSON.stringify(poll.answers),
                                    poll.textRes,
                                    poll.blind,
                                    poll.allowVoteChanges,
                                    poll.allowMultipleResponses,
                                    poll.weight,
                                    poll.public,
                                    pollId,
                                ],
                                (err) => {
                                    try {
                                        if (err) throw err;

                                        socket.emit("message", "Poll saved successfully!");
                                        socketUpdates.customPollUpdate(socketContext.session.email);
                                    } catch (err) {
                                        handleSocketError(err, socket, "savePoll:update:dbRun");
                                    }
                                }
                            );
                        } catch (err) {
                            handleSocketError(err, socket, "savePoll:update:dbGet");
                        }
                    });
                } else {
                    database.get('SELECT seq AS nextPollId from sqlite_sequence WHERE name = "custom_polls"', (err, nextPollId) => {
                        try {
                            if (err) throw err;

                            nextPollId = nextPollId.nextPollId + 1;

                            database.run(
                                "INSERT INTO custom_polls (owner, name, prompt, answers, textRes, blind, allowVoteChanges, allowMultipleResponses, weight, public) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                [
                                    userId,
                                    poll.name,
                                    poll.prompt,
                                    JSON.stringify(poll.answers),
                                    poll.textRes,
                                    poll.blind,
                                    poll.allowVoteChanges,
                                    poll.allowMultipleResponses,
                                    poll.weight,
                                    poll.public,
                                ],
                                (err) => {
                                    try {
                                        if (err) throw err;

                                        classStateStore.updateClassroomStudent(
                                            socketContext.session.classId,
                                            socketContext.session.email,
                                            (student) => {
                                                if (!Array.isArray(student.ownedPolls)) {
                                                    student.ownedPolls = [];
                                                }
                                                student.ownedPolls.push(nextPollId);
                                            }
                                        );
                                        socket.emit("message", "Poll saved successfully!");
                                        socketUpdates.customPollUpdate(socketContext.session.email);
                                    } catch (err) {
                                        handleSocketError(err, socket, "savePoll:insert:dbRun");
                                    }
                                }
                            );
                        } catch (err) {
                            handleSocketError(err, socket, "savePoll:insert:dbGet");
                        }
                    });
                }
            } catch (err) {
                handleSocketError(err, socket, "savePoll");
            }
        });

        onSocketEvent(socket, "setPublicPoll", hasClassScope(SCOPES.CLASS.POLL.SHARE), async (socketContext, pollId, value) => {
            try {
                database.run("UPDATE custom_polls set public=? WHERE id=?", [value, pollId], (err) => {
                    try {
                        if (err) throw err;

                        for (const [email] of Object.entries(socketStateStore.getUserSockets())) {
                            socketUpdates.customPollUpdate(email);
                        }
                    } catch (err) {
                        handleSocketError(err, socket, "setPublicPoll:dbRun");
                    }
                });
            } catch (err) {
                handleSocketError(err, socket, "setPublicPoll");
            }
        });
    },
};
