const { classStateStore } = require("@services/classroom-service");

const { generateColors } = require("@modules/util");
const { advancedEmitToClass, userUpdateSocket } = require("@services/socket-updates-service");
const { dbGet, dbGetAll, dbRun } = require("@modules/database");
const { userHasScope } = require("@modules/scope-resolver");
const { SCOPES } = require("@modules/permissions");
const { userSocketUpdates } = require("../sockets/init");
const NotFoundError = require("@errors/not-found-error");
const ValidationError = require("@errors/validation-error");
const ForbiddenError = require("@errors/forbidden-error");
const { requireInternalParam } = require("@modules/error-wrapper");
const { pollRuntimeStore } = require("@stores/poll-runtime-store");

/**
 * Gets a classroom by ID and throws an error if not found.
 * @param {number} classId - The ID of the class.
 * @returns {Object} The classroom object.
 * @throws {NotFoundError} If classroom is not found.
 */
function getClassroom(classId) {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) {
        throw new NotFoundError("Classroom not found");
    }
    return classroom;
}

/**
 * Resets all students' poll responses in a classroom.
 * @param {Object} classroom - The classroom object.
 * @returns {void}
 */
function resetStudentPollResponses(classroom) {
    for (const key in classroom.students) {
        classroom.students[key].pollRes.buttonRes = "";
        classroom.students[key].pollRes.textRes = "";
    }
}

/**
 * Checks if a user is excluded from voting in a poll.
 * @param {Object} classroom - The classroom object.
 * @param {Object} user - The user object.
 * @param {Object} student - The student object.
 * @returns {boolean} True if user is excluded, false otherwise.
 */
function isUserExcludedFromVoting(classroom, user, student) {
    // Check if user is excluded from voting using poll.excludedRespondents
    if (classroom.poll.excludedRespondents && classroom.poll.excludedRespondents.includes(user.id)) {
        logger.log("info", `[pollResponse] User ${user.id} is excluded from voting`);
        return true;
    }

    return false;
}

/**
 * Validates if a poll response is valid for the current poll.
 * @param {Object} poll - The poll object.
 * @param {(string|string[])} res - The response to validate.
 * @param {boolean} isRemoving - Whether the user is removing their response.
 * @returns {boolean} True if valid, false otherwise.
 */
function isValidPollResponse(poll, res, isRemoving) {
    if (!poll.allowMultipleResponses) {
        if (res !== "remove" && !poll.responses.some((response) => response.answer === res)) {
            return false;
        }
    } else {
        if (isRemoving) {
            return true;
        } else if (!Array.isArray(res)) {
            return false;
        } else {
            const validResponses = poll.responses.map((r) => r.answer);
            const allValid = res.every((response) => validResponses.includes(response));
            if (!allValid) {
                return false;
            }
        }
    }
    return true;
}

/**
 * Calculates the weight of a poll response.
 * @param {Object} poll - The poll object.
 * @param {(string|string[])} res - The response.
 * @returns {number} The calculated weight.
 */
function calculateResponseWeight(poll, res) {
    let resWeight;

    if (poll.allowMultipleResponses && Array.isArray(res)) {
        // Sum weights for all selected responses
        resWeight = res.reduce((sum, answer) => {
            const responseObj = poll.responses.find((response) => response.answer === answer);
            return sum + (responseObj ? responseObj.weight : 1);
        }, 0);
    } else {
        // Single response
        const responseObj = poll.responses.find((response) => response.answer === res);
        resWeight = responseObj ? responseObj.weight : 1;
    }

    return resWeight;
}

/**
 * Converts the selected button answers into the response option ids stored in poll_history.responses.
 * @param {Array<Object>} pollResponses - The response options for the saved poll.
 * @param {(string|string[])} buttonRes - The student's selected answer(s).
 * @returns {string|null} JSON array of selected response ids, or null when there are no button selections.
 */
function getSelectedResponseIds(pollResponses, buttonRes) {
    const selectedAnswers = Array.isArray(buttonRes)
        ? buttonRes
        : buttonRes !== "" && buttonRes !== null && buttonRes !== undefined
          ? [buttonRes]
          : [];

    if (selectedAnswers.length === 0) return null;

    const responseIdsByAnswer = new Map(pollResponses.map((response, index) => [response.answer, response.id ?? index]));
    const responseIds = selectedAnswers.filter((answer) => responseIdsByAnswer.has(answer)).map((answer) => responseIdsByAnswer.get(answer));

    return responseIds.length > 0 ? JSON.stringify(responseIds) : null;
}

/**
 * Updates a student's poll response state.
 * @param {Object} student - The student object.
 * @param {(string|string[])} res - The button response.
 * @param {string} textRes - The text response.
 * @param {boolean} isRemoving - Whether the user is removing their response.
 * @param {boolean} allowMultipleResponses - Whether multiple responses are allowed.
 * @returns {void}
 */
function updateStudentPollResponse(student, res, textRes, isRemoving, allowMultipleResponses) {
    if (isRemoving) {
        student.pollRes.buttonRes = allowMultipleResponses ? [] : "";
        student.pollRes.textRes = "";
        student.pollRes.time = "";
    } else {
        student.pollRes.buttonRes = res;
        student.pollRes.textRes = textRes;
        student.pollRes.time = new Date();
    }
}

/**
 * Creates a new poll in the class.
 * @param {number} classId - The ID of the class.
 * @param {Object} pollData - The data for the poll.
 * @param {Object} userData - The user session object.
 * @returns {Promise<void>}
 * @throws {NotFoundError} If classroom is not found
 * @throws {ValidationError} If class is not active
 */
async function createPoll(classId, pollData, userData) {
    const {
        prompt,
        answers,
        blind,
        weight,
        excludedRespondents,
        allowVoteChanges,
        allowTextResponses,
        allowMultipleResponses,
        autoEndTimer,
        autoEndThreshold,
        blindUntilEnded,
    } = pollData;
    const numberOfResponses = Object.keys(answers).length;

    requireInternalParam(classId, "classId");
    requireInternalParam(pollData, "pollData");
    requireInternalParam(userData, "userData");

    pollRuntimeStore.resetPogMeterTracker(classId);

    const classroom = getClassroom(classId);

    // Check if the class is active before continuing
    if (!classroom.isActive) {
        throw new ValidationError("This class is not currently active");
    }

    await clearPoll(classId, userData, false);
    const generatedColors = generateColors(Object.keys(answers).length);

    classroom.poll.allowVoteChanges = allowVoteChanges;
    classroom.poll.blind = blind;
    classroom.poll.status = true;

    // If excludedRespondents is provided and is a non-empty array, use it directly
    if (excludedRespondents && Array.isArray(excludedRespondents) && excludedRespondents.length > 0) {
        classroom.poll.excludedRespondents = excludedRespondents.map((id) => Number(id));
    }

    // Creates an object for every answer possible the teacher is allowing
    const letterString = "abcdefghijklmnopqrstuvwxyz";
    for (let i = 0; i < numberOfResponses; i++) {
        let answer = letterString[i];
        let weight = 1;
        let color = generatedColors[i];

        if (answers[i].answer) {
            answer = answers[i].answer;
        }

        if (answers[i].weight) {
            if (isNaN(answers[i].weight) || answers[i].weight <= 0) weight = 1;
            weight = Math.floor(answers[i].weight * 100) / 100;
            weight = weight > 5 ? 5 : weight;
        }

        if (answers[i].color) {
            color = answers[i].color;
        }

        classroom.poll.responses.push({
            id: i,
            answer: answer,
            weight: weight,
            color: color,
            isCorrect: !!(answers[i].isCorrect ?? answers[i].correct),
        });
    }

    const pollStartTime = Date.now();

    // Set the poll's data in the classroom
    pollRuntimeStore.setPollStartTime(classId, pollStartTime);
    classroom.poll = {
        ...classroom.poll,
        startTime: pollStartTime,
        weight: weight,
        allowTextResponses: allowTextResponses,
        prompt: prompt,
        allowMultipleResponses: allowMultipleResponses,
        time: time,
        autoEndThreshold: autoEndThreshold,
        autoEndTimer: autoEndTimer,
    };

    watchPoll(classId, classroom.poll);

    resetStudentPollResponses(classroom);
    userUpdateSocket(userData.email, "classUpdate", classId, { global: true });
}

/**
 * Updates poll properties dynamically. Can update individual properties or clear the entire poll.
 * @param {number} classId - The ID of the class.
 * @param {Object} options - An object containing poll properties to update.
 * @param {Object} userSession - The user session object.
 * @returns {Promise<boolean>} True if successful.
 * @throws {ValidationError} If classId or options are missing
 * @throws {NotFoundError} If classroom is not found
 *
 * Examples:
 * * - updatePoll(classId, {status: false}, session) - Ends the poll
 * * - updatePoll(classId, {success: true}, session) - Resumes the poll
 * * - updatePoll(classId, {}, session) - Clears the poll (empty object)
 */
async function updatePoll(classId, options, userSession) {
    // If no classId or options provided, throw validation error
    if (!classId || !options) {
        throw new ValidationError("Missing classId or options");
    }

    const classroom = getClassroom(classId);

    // If an empty object is sent, clear the current poll
    const optionsKeys = Object.keys(options);
    if (optionsKeys.length === 0) {
        await clearPoll(classId, userSession);
        return true;
    }

    // Update each poll property
    for (const option of Object.keys(options)) {
        let value = options[option];

        // Save to history when ending poll
        if (option === "status" && value === false && classroom.poll.status === true) {
            // If the poll is set to blind until ended, then unblind the poll
            if (classroom.poll.blindUntilEnded) {
                classroom.poll.blind = false;
            }

            const savedPollId = await savePollToHistory(classId);
            pollRuntimeStore.setLastSavedPollId(classId, savedPollId);
        }

        // If studentsAllowedToVote is being changed, then ensure it always contains numbers
        if (option === "studentsAllowedToVote" && Array.isArray(value)) {
            value = value.map((id) => Number(id));
        }

        // Update the property if it exists in the poll object
        if (option in classroom.poll) {
            classroom.poll[option] = value;
        }
    }

    // Broadcast update to all tabs
    const userSockets = userSocketUpdates.get(userSession.email);
    if (userSockets && userSockets.size > 0) {
        const firstSocket = userSockets.values().next().value;
        firstSocket.classUpdate(classId, { global: true });
    }
    return true;
}

/**
 * Gets previous polls for a class from the database with pagination.
 * Post-processes results to ensure proper types (booleans as actual booleans, responses as parsed objects).
 * @param {number} classId - The ID of the class.
 * @param {number} [limit=20] - The maximum number of records to return.
 * @param {number} [offset=0] - The number of records to skip.
 * @returns {Promise<Object>} An object containing polls array and total count.
 */
async function getPreviousPolls(classId, limit = 20, offset = 0) {
    requireInternalParam(classId, "classId");

    const totalRow = await dbGet(`SELECT COUNT(*) AS count FROM poll_history WHERE class = ?`, [classId]);
    const polls = await dbGetAll(
        `SELECT *, ROW_NUMBER() OVER (ORDER BY id) AS pollId
         FROM poll_history
         WHERE class = ?
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [classId, limit, offset]
    );

    const enrichedPolls = polls.map((poll) => {
        // Parse responses into a predictable array for clients.
        let parsedResponses = poll.responses;
        if (typeof poll.responses === "string") {
            try {
                parsedResponses = JSON.parse(poll.responses);
            } catch (err) {
                parsedResponses = [];
            }
        }

        if (!Array.isArray(parsedResponses)) {
            parsedResponses = [];
        }

        return {
            globalPollId: poll.id,
            classPollId: Number(poll.pollId),
            prompt: poll.prompt,
            responses: parsedResponses,
            blind: !!poll.blind,
            allowMultipleResponses: !!poll.allowMultipleResponses,
            allowTextResponses: !!poll.allowTextResponses,
            createdAt: poll.createdAt,
        };
    });

    return {
        polls: enrichedPolls,
        total: totalRow ? totalRow.count : 0,
    };
}

/**
 * Saves the current poll data to the poll history table in the database.
 * @param {number} classId - The ID of the class whose poll should be saved.
 * @returns {Promise<void>}
 */
async function savePollToHistory(classId) {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return;

    const createdAt = Date.now();
    const prompt = classroom.poll.prompt;
    const responses = JSON.stringify(classroom.poll.responses);
    const allowMultipleResponses = classroom.poll.allowMultipleResponses ? 1 : 0;
    const blind = classroom.poll.blind ? 1 : 0;
    const allowTextResponses = classroom.poll.allowTextResponses ? 1 : 0;
    const autoEndTimer = classroom.poll.autoEndTimer;
    const autoEndThreshold = classroom.poll.autoEndThreshold;

    return dbRun(
        "INSERT INTO poll_history(class, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt, auto_end_timer, auto_end_threshold) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [classId, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt, autoEndTimer, autoEndThreshold]
    );
}

/**
 * Clears the current poll in the specified class, optionally updates the class state,
 * and saves poll answers to the database.
 *
 * @param {number} classId - The ID of the class.
 * @param {Object} userSession - The user session object.
 * @param {boolean} [updateClass=true] - Whether to update the class state after clearing the poll.
 * @returns {Promise<void>}
 */
async function clearPoll(classId, userSession, updateClass = true) {
    const classroom = classStateStore.getClassroom(classId);
    if (classroom.poll.status) {
        await updatePoll(classId, { status: false }, userSession);
    }

    const currentPollId = pollRuntimeStore.getLastSavedPollId(classId);
    const savedPollResponses = classroom.poll.responses;

    classroom.poll.responses = [];
    classroom.poll.prompt = "";
    classroom.poll = {
        status: false,
        responses: [],
        allowTextResponses: false,
        prompt: "",
        weight: 1,
        blind: false,
        excludedRespondents: [],
    };

    // Adds data to the previous poll answers table upon clearing the poll
    if (!currentPollId) {
        if (updateClass && userSession) {
            userUpdateSocket(userSession.email, "classUpdate", classId, { global: true });
        }
        pollRuntimeStore.clearPogMeterTracker(classId);
        pollRuntimeStore.clearLastSavedPollId(classId);
        pollRuntimeStore.clearPollStartTime(classId);
        return;
    }

    const rows = [];
    for (const student of Object.values(classroom.students)) {
        if (!userHasScope(student, SCOPES.CLASS.SYSTEM.ADMIN, classroom)) {
            const buttonRes = student.pollRes.buttonRes;
            let buttonResponse = null;
            if (Array.isArray(buttonRes) && buttonRes.length > 0) {
                // Multi-response: store the full array
                buttonResponse = JSON.stringify(buttonRes);
            } else if (!Array.isArray(buttonRes) && buttonRes !== "" && buttonRes !== null && buttonRes !== undefined) {
                // Single response: wrap in an array
                buttonResponse = JSON.stringify([buttonRes]);
            }

            const textResponse = student.pollRes.textRes || null;
            const responseIds = getSelectedResponseIds(savedPollResponses, buttonRes);

            // Skip students with no response at all
            if (buttonResponse === null && textResponse === null) continue;

            const studentId = student.id;
            rows.push([currentPollId, classId, studentId, responseIds, buttonResponse, textResponse, Date.now()]);
        }
    }

    // Insert all of the poll answers into the database at once
    if (rows.length > 0) {
        const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",");
        const values = rows.flat();

        await dbRun(
            `INSERT OR REPLACE INTO poll_answers(pollId, classId, userId, responseIds, buttonResponse, textResponse, createdAt) VALUES ${placeholders}`,
            values
        );
    }

    if (updateClass && userSession) {
        userUpdateSocket(userSession.email, "classUpdate", classId, { global: true });
    }

    pollRuntimeStore.clearPogMeterTracker(classId);
    pollRuntimeStore.clearLastSavedPollId(classId);
    pollRuntimeStore.clearPollStartTime(classId);
}

/**
 * Handles a student's poll response, updates their answer, manages pog meter, and triggers class updates.
 * @param {number} classId - The ID of the class.
 * @param {(string|string[])} res - The button response(s) from the student, or 'remove' to clear.
 * @param {string} textRes - The text response from the student.
 * @param {Object} userSession - The user session object.
 * @returns {void}
 */
async function sendPollResponse(classId, res, textRes, userSession) {
    const resLength = textRes != null ? textRes.length : 0;

    const email = userSession.email;
    const user = classStateStore.getUser(email);
    const classroom = classStateStore.getClassroom(classId);

    // If the classroom does not exist, return
    if (!classroom) {
        return;
    }

    // If there's no poll or the poll is not active, return
    if (!classroom.poll || !classroom.poll.status) {
        return;
    }

    const student = classroom.students[email];

    // Check if user is excluded from voting
    if (isUserExcludedFromVoting(classroom, user, student)) {
        return;
    }

    // If the user's response has not changed, return
    const prevRes = student.pollRes.buttonRes;
    let hasChanged = classroom.poll.allowMultipleResponses ? JSON.stringify(prevRes) !== JSON.stringify(res) : prevRes !== res;

    if (!classroom.poll.allowVoteChanges && prevRes !== "" && JSON.stringify(prevRes) !== JSON.stringify(res)) {
        return;
    }

    const isRemoving = res === "remove" || (classroom.poll.allowMultipleResponses && Array.isArray(res) && res.length === 0);

    // Validate poll response
    if (!isValidPollResponse(classroom.poll, res, isRemoving)) {
        return;
    }

    // If the user is removing their response and they previously had no response, do not play sound
    if (isRemoving && prevRes === "") {
        hasChanged = false;
    }

    if (hasChanged || student.pollRes.textRes !== textRes) {
        if (isRemoving) {
            advancedEmitToClass("removePollSound", classId, {});
        } else {
            advancedEmitToClass("pollSound", classId, {});
        }
    }

    // Update student's poll response
    updateStudentPollResponse(student, res, textRes, isRemoving, classroom.poll.allowMultipleResponses);

    // Handle pog meter updates
    if (!isRemoving && !pollRuntimeStore.hasPogMeterIncreased(classId, email)) {
        const resWeight = calculateResponseWeight(classroom.poll, res);

        // Increase pog meter by 100 times the weight of the response
        // If pog meter reaches 100, increase digipogs by 1 and reset pog meter to 0
        const pogMeterIncrease = Math.floor((process.env.POG_METER_INCREMENT || 20) * resWeight);
        student.pogMeter += pogMeterIncrease;
        if (student.pogMeter >= 100) {
            student.pogMeter -= 100;
            let addPogs = Math.floor(Math.random() * 10) + 1; // Randomly add between 1 and 10 digipogs
            await dbRun("UPDATE users SET digipogs = digipogs + ? WHERE id = ?", [addPogs, student.id]);
        }

        await dbRun("UPDATE users SET pog_meter = ? WHERE id = ?", [student.pogMeter, student.id]);

        pollRuntimeStore.markPogMeterIncreased(classId, email);
    }

    userUpdateSocket(email, "classUpdate", classId, { global: true });
}

/**
 * Function to get the poll responses in a class.
 * @param {Object} classData - The data of the class.
 * @returns {Object} An object containing the poll responses.
 */
function getPollResponses(classData) {
    // Create an empty object to store the poll responses
    let tempPolls = {};

    // If the poll is not active, return an empty object
    if (!classData.poll.status) return {};

    // If there are no responses to the poll, return an empty object
    if (classData.poll.responses.length == 0) return {};

    // For each response in the poll responses
    for (let resValue of classData.poll.responses) {
        // Add the response to the tempPolls object and initialize the count of responses to 0
        tempPolls[resValue.answer] = {
            ...resValue,
            responses: 0,
        };
    }

    // For each student in the class
    for (let student of Object.values(classData.students)) {
        // If the student exists and has responded to the poll
        if (student && Object.keys(tempPolls).includes(student.pollRes.buttonRes)) {
            // Increment the count of responses for the student's response
            tempPolls[student.pollRes.buttonRes].responses++;
        }
    }

    // Return the tempPolls object
    return tempPolls;
}

/**
 * Gets the current poll for an active class and validates access.
 * @param {number|string} classId - The class ID.
 * @param {Object} userData - The requesting user session object.
 * @returns {Promise<Object>} Poll data including total student count.
 * @throws {ValidationError} If required params are missing.
 * @throws {NotFoundError} If class does not exist or is not currently active.
 * @throws {ForbiddenError} If user is not in the class.
 */
async function getCurrentPoll(classId, userData) {
    requireInternalParam(classId, "classId");
    requireInternalParam(userData, "userData");

    const classroom = classStateStore.getClassroom(classId);

    if (!classroom) {
        const classroomRow = await dbGet("SELECT id FROM classroom WHERE id = ?", [classId]);
        if (classroomRow) {
            throw new NotFoundError("This class is not currently active");
        }
        throw new NotFoundError("This class does not exist");
    }

    if (!classroom.students[userData.email]) {
        throw new ForbiddenError("You do not have permission to view polls in this class");
    }

    const poll = structuredClone(classroom.poll);
    return {
        ...poll,
        status: poll.status,
        totalStudents: Object.keys(classroom.students).length,
    };
}

/**
 * Deletes all custom polls owned by a user
 * @param {number} userId - The ID of the user whose custom polls should be deleted
 * @returns {Promise<void>}
 */
async function deleteCustomPolls(userId) {
    const customPolls = await dbGetAll("SELECT * FROM custom_polls WHERE owner=?", userId);
    if (customPolls.length == 0) return;

    await dbRun("DELETE FROM custom_polls WHERE owner=?", userId);
    for (let customPoll of customPolls) {
        await dbRun("DELETE FROM shared_polls WHERE pollId=?", customPoll.id);
    }
}

// Map of classId to timeout id
// Used to clear the timeout when the poll is cleared
const watchedPolls = new Map();

/**
 * Watches the poll for certain conditions which will trigger an automatic end of the poll.
 * @param {number} classId - The ID of the class.
 * @returns {Promise<void>}
 */
function watchPoll(classId, pollData) {
    const { autoEndTimer, autoEndThreshold } = pollData;
    if (autoEndTimer) {
        watchedPolls
            .set(
                classId,
                setTimeout(() => {
                    const classroom = classStateStore.getClassroom(classId);
                    if (!classroom || !classroom.poll || !classroom.poll.status || classroom.poll.startTime !== pollData.startTime) {
                        watchedPolls.delete(classId);
                        return;
                    }

                    const pollTime = Date.now() - classroom.poll.startTime;
                    if (pollTime >= autoEndTimer) {
                        if (!autoEndThreshold) {
                            clearPoll(classId, null, false);
                            return;
                        }

                        const onlineStudents = Object.keys(classroom.students).filter((student) => !classroom.students[student].isOffline).length;
                        const responsePercentage = classroom.poll.responses.length / onlineStudents;
                        if (responsePercentage >= autoEndThreshold) {
                            clearPoll(classId, null, false);
                        }
                    }
                }, autoEndTimer)
            )
            .unref();
    }
}

function deleteWatchedPoll(classId) {
    const timer = watchedPolls.get(classId);
    if (!timer) return;

    clearTimeout(watchedPolls.get(classId));
    watchedPolls.delete(classId);
}

module.exports = {
    createPoll,
    updatePoll,
    getPreviousPolls,
    getCurrentPoll,
    savePollToHistory,
    clearPoll,
    sendPollResponse,
    getPollResponses,
    deleteCustomPolls,
    pollRuntimeStore,
    deleteWatchedPoll,
};
