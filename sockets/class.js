const { classStateStore } = require("@services/classroom-service");
const { database, dbRun } = require("@modules/database");
const { advancedEmitToClass, setClassOfApiSockets } = require("@services/socket-updates-service");
const { io } = require("@modules/web-server");
const {
    startClass,
    endClass,
    leaveClass,
    isClassActive,
    joinClass,
    classKickStudent,
    classKickStudents,
    updateClassSetting,
    regenerateClassCode,
} = require("@services/class-service");
const { enrollInClass, unenrollFromClass } = require("@services/class-membership-service");
const { getEmailFromId, getIdFromEmail } = require("@services/student-service");
const { BANNED_PERMISSIONS } = require("@modules/permissions");
const { handleSocketError } = require("@modules/socket-error-handler");
const { classCodeCacheStore } = require("@stores/class-code-cache-store");
const { buildRoleReferences } = require("@modules/role-reference");

module.exports = {
    run(socket, socketUpdates) {
        // Starts a classroom session
        socket.on("startClass", () => {
            try {
                const email = socket.request.session.email;
                const classId = classStateStore.getUser(email).activeClass;
                startClass(classId);
            } catch (err) {
                handleSocketError(err, socket, "startClass", "There was a server error. Please try again");
            }
        });

        // Ends a classroom session
        socket.on("endClass", () => {
            try {
                const email = socket.request.session.email;
                const classId = classStateStore.getUser(email).activeClass;
                endClass(classId, socket.request.session);
            } catch (err) {
                handleSocketError(err, socket, "endClass", "There was a server error. Please try again");
            }
        });

        // Join a classroom session
        socket.on("joinClass", async (classId) => {
            await joinClass(socket.request.session, classId);
        });

        // Enrolls in a classroom by code
        socket.on("joinRoom", async (classCode) => {
            try {
                await enrollInClass(socket.request.session, classCode);
            } catch (err) {
                handleSocketError(err, socket, "joinRoom", "There was a server error. Please try again");
            }
        });

        /**
         * Leaves the classroom session
         * The user is still associated with the class, but they're not active in it
         */
        socket.on("leaveClass", async () => {
            try {
                leaveClass(socket.request.session);
            } catch (err) {
                handleSocketError(err, socket, "leaveClass", "There was a server error. Please try again");
            }
        });

        /**
         * Permanently unenrolls the user from the classroom.
         * The user is no longer associated with the class.
         */
        socket.on("leaveRoom", async () => {
            try {
                await unenrollFromClass(socket.request.session);
            } catch (err) {
                handleSocketError(err, socket, "leaveRoom", "There was a server error. Please try again");
            }
        });

        socket.on("getActiveClass", () => {
            try {
                const api = socket.request.session.api;

                for (const email in classStateStore.getAllUsers()) {
                    const user = classStateStore.getAllUsers()[email];
                    if (user.API == api) {
                        setClassOfApiSockets(api, user.activeClass);
                        return;
                    }
                }

                // If no class is found, set the class to null
                setClassOfApiSockets(api, null);
            } catch (err) {
                handleSocketError(err, socket, "getActiveClass");
            }
        });

        /**
         * Sets a setting for the classroom
         * @param {string} setting - A string representing the setting to change.
         * @param {string} value - The value to set the setting to.
         */
        socket.on("setClassSetting", async (setting, value) => {
            try {
                const classId = socket.request.session.classId;
                await updateClassSetting(classId, setting, value);

                // Trigger a class update to sync all clients
                socketUpdates.classUpdate(classId);
            } catch (err) {
                handleSocketError(err, socket, "setClassSetting");
            }
        });

        /**
         * Checks if the class the user is currently in is active
         * Returns true or false on the same event
         */
        socket.on("isClassActive", () => {
            try {
                const isActive = isClassActive(socket.request.session.classId);
                socket.emit("isClassActive", isActive);
            } catch (err) {
                handleSocketError(err, socket, "isClassActive");
            }
        });

        // Regenerates the class code for the classroom in the teacher's session
        socket.on("regenerateClassCode", async () => {
            try {
                const classId = socket.request.session.classId;

                await regenerateClassCode(classId);
                socket.emit("reload");
            } catch (err) {
                handleSocketError(err, socket, "regenerateClassCode");
            }
        });

        /**
         * Changes the class name
         * @param {string} name - The new name of the class.
         */
        socket.on("changeClassName", (name) => {
            try {
                if (!name) {
                    socket.emit("message", "Class name cannot be empty.");
                    return;
                }

                // Update the class name in the database
                database.run("UPDATE classroom SET name=? WHERE id= ?", [name, socket.request.session.classId], (err) => {
                    try {
                        if (err) throw err;

                        // Update the class name in the class information
                        classStateStore.updateClassroom(socket.request.session.classId, { className: name });
                        socket.emit("changeClassName", name);
                        socket.emit("message", "Class name updated.");
                    } catch (err) {
                        handleSocketError(err, socket, "changeClassName:callback", "There was a server error try again.");
                    }
                });
            } catch (err) {
                handleSocketError(err, socket, "changeClassName");
            }
        });

        /**
         * Deletes a classroom
         * @param {string} classId - The ID of the classroom to delete.
         */
        socket.on("deleteClass", (classId) => {
            try {
                database.get("SELECT * FROM classroom WHERE id=?", classId, (err, classroom) => {
                    try {
                        if (err) throw err;

                        if (classroom) {
                            if (classStateStore.getClassroom(classId)) {
                                socketUpdates.endClass(classroom.key, classroom.id);
                            }
                            classCodeCacheStore.invalidateByClassId(classroom.id);

                            database.run("DELETE FROM classroom WHERE id=?", classroom.id);
                            database.run("DELETE FROM classusers WHERE classId=?", classroom.id);
                            database.run("DELETE FROM poll_history WHERE class=?", classroom.id);
                        }

                        socketUpdates.getOwnedClasses(socket.request.session.email);
                    } catch (err) {
                        handleSocketError(err, socket, "deleteClass:callback");
                    }
                });
            } catch (err) {
                handleSocketError(err, socket, "deleteClass");
            }
        });

        /**
         * Kicks a user from the classroom
         * @param {string} email - The email of the user to kick.
         */
        socket.on("classKickStudent", async (email) => {
            try {
                const classId = socket.request.session.classId;
                const userId = await getIdFromEmail(email);
                classKickStudent(userId, classId);
                advancedEmitToClass("leaveSound", classId, {});
            } catch (err) {
                handleSocketError(err, socket, "classKickStudent");
            }
        });

        /**
         * Removes a student from the current class session without removing them from the classroom roster.
         * The student will appear as offline on the teacher's page but can rejoin the session.
         * @param {number} userId - The ID of the user to remove from the session.
         */
        socket.on("classRemoveFromSession", (userId) => {
            try {
                logger.log("info", `[classRemoveFromSession] ip=(${socket.handshake.address}) session=(${JSON.stringify(socket.request.session)})`);
                logger.log("info", `[classRemoveFromSession] userId=(${userId})`);

                const classId = socket.request.session.classId;
                classKickStudent(userId, classId, { exitRoom: false, ban: false });
            } catch (err) {
                logger.log("error", err.stack);
            }
        });

        // Removes all students from the class
        socket.on("classKickStudents", async () => {
            try {
                const classId = socket.request.session.classId;
                await classKickStudents(classId);

                socketUpdates.classUpdate(classId);
                advancedEmitToClass("kickStudentsSound", classId, { api: true });
            } catch (err) {
                handleSocketError(err, socket, "classKickStudents");
            }
        });

        /**
         * Bans a user from the classroom
         * @param {string} email - The email of the user to ban.
         */
        socket.on("classBanUser", async (email) => {
            try {
                let classId = socket.request.session.classId;

                if (!classId) {
                    socket.emit("message", "You are not in a class");
                    return;
                }

                if (!email) {
                    socket.emit("message", "No email provided. (Please contact the programmer)");
                    return;
                }

                // Assign the Banned role via user_roles
                const { findRoleByPermissionLevel } = require("@services/role-service");
                const userId = await getIdFromEmail(email);
                const blockedRole = await findRoleByPermissionLevel(BANNED_PERMISSIONS, classId);
                if (userId) {
                    if (blockedRole) {
                        await dbRun("DELETE FROM user_roles WHERE userId = ? AND classId = ?", [userId, classId]);
                        await dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [userId, blockedRole.id, classId]);
                    }
                }

                if (classStateStore.getClassroomStudent(classId, email)) {
                    const bannedRole = blockedRole
                        ? classStateStore.getClassroom(classId)?.availableRoles?.find((role) => Number(role.id) === Number(blockedRole.id)) || null
                        : null;
                    const existingStudent = classStateStore.getClassroomStudent(classId, email);
                    classStateStore.updateClassroomStudent(classId, email, {
                        roles: {
                            global: existingStudent?.roles?.global || [],
                            class: bannedRole ? buildRoleReferences([bannedRole]) : [],
                        },
                    });
                }

                classKickStudent(userId, classId, { exitRoom: true, ban: true });
                socketUpdates.classBannedUsersUpdate();
                socketUpdates.classUpdate();
                socket.emit("message", `Banned ${email}`);
            } catch (err) {
                handleSocketError(err, socket, "classBanUser", "There was a server error try again.");
            }
        });

        /**
         * Unbans a user from the classroom
         * @param {string} email - The email of the user to unban.
         */
        socket.on("classUnbanUser", async (email) => {
            try {
                let classId = socket.request.session.classId;

                if (!classId) {
                    socket.emit("message", "You are not in a class");
                    return;
                }

                if (!email) {
                    socket.emit("message", "No email provided. (Please contact the programmer)");
                    return;
                }

                // Remove the Banned role — user reverts to Guest (implicit)
                const userId = await getIdFromEmail(email);
                if (userId) {
                    await dbRun("DELETE FROM user_roles WHERE userId = ? AND classId = ?", [userId, classId]);
                }

                if (classStateStore.getClassroomStudent(classId, email)) {
                    const existingStudent = classStateStore.getClassroomStudent(classId, email);
                    classStateStore.updateClassroomStudent(classId, email, {
                        roles: { global: existingStudent?.roles?.global || [], class: [] },
                    });
                }

                // Kick user so they rejoin fresh
                getIdFromEmail(email)
                    .then((uid) => {
                        classKickStudent(uid, classId, { exitRoom: true, ban: false });
                        socketUpdates.classUpdate();
                    })
                    .catch(() => {});

                socketUpdates.classBannedUsersUpdate();
                socket.emit("message", `Unbanned ${email}`);
            } catch (err) {
                handleSocketError(err, socket, "classUnbanUser", "There was a server error try again.");
            }
        });

        socket.on("updateExcludedRespondents", (respondants) => {
            try {
                const classId = socket.request.session.classId;
                const classroom = classStateStore.getClassroom(classId);
                if (!Array.isArray(respondants)) return;

                // Contains the list of student IDs who should be excluded from the poll
                const excludedRespondents = [...respondants];

                // Also automatically exclude students who are offline, on break, or have excluded tag
                for (const studentEmail of Object.keys(classroom.students)) {
                    const student = classroom.students[studentEmail];
                    const studentId = student.id;

                    // If the student doesn't exist, is offline/excluded, or is on break, add them to excluded list
                    if (
                        (!student || (student.tags && (student.tags.includes("Offline") || student.tags.includes("Excluded"))) || student.onBreak) &&
                        !excludedRespondents.includes(studentId)
                    ) {
                        excludedRespondents.push(studentId);
                    }
                }

                // Update both excludedRespondent properties to keep them in sync
                classroom.poll.excludedRespondents = excludedRespondents;

                // Clear votes from newly excluded students
                clearVotesFromExcludedStudents(classId);

                socketUpdates.classUpdate(classId);
            } catch (err) {
                handleSocketError(err, socket, "updateExcludedRespondents");
            }
        });
    },
};
