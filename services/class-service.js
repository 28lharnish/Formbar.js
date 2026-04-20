const { dbGetAll, dbGet, dbRun, database } = require("@modules/database");
const {
    advancedEmitToClass,
    emitToUser,
    setClassOfApiSockets,
    setClassOfUserSockets,
    userUpdateSocket,
    invalidateClassPollCache,
} = require("@services/socket-updates-service");
const { Classroom, classStateStore, getClassIDFromCode } = require("@services/classroom-service");
const { classCodeCacheStore } = require("@stores/class-code-cache-store");
const { socketStateStore } = require("@stores/socket-state-store");
const {
    computeClassPermissionLevel,
    BANNED_PERMISSIONS,
    GUEST_PERMISSIONS,
    MOD_PERMISSIONS,
    TEACHER_PERMISSIONS,
    MANAGER_PERMISSIONS,
} = require("@modules/permissions");
const { isClassOwner, getUserScopes } = require("@modules/scope-resolver");
const { getStudentsInClass, getIdFromEmail, getEmailFromId } = require("@services/student-service");
const { generateKey } = require("@modules/util");
const { clearPoll } = require("@services/poll-service");
const {
    loadCustomRoles,
    getClassRoles,
    getStudentRoleAssignments,
    addDefaultClassRoles,
    findRoleByPermissionLevel,
} = require("@services/role-service");
const { requireInternalParam } = require("@modules/error-wrapper");
const { buildRoleReferences } = require("@modules/role-reference");
const { io } = require("@modules/web-server");
const ValidationError = require("@errors/validation-error");
const NotFoundError = require("@errors/not-found-error");
const ForbiddenError = require("@errors/forbidden-error");
const AppError = require("@errors/app-error");

function getUserJoinedClasses(userId) {
    return dbGetAll(
        "SELECT classroom.name, classroom.id FROM classroom JOIN classusers ON classroom.id = classusers.classId WHERE classusers.studentId = ?",
        [userId]
    );
}

function getClassLinks(classId) {
    return dbGetAll("SELECT name, url FROM links WHERE classId = ?", [classId]);
}

async function getClassCode(classId) {
    const result = await dbGet("SELECT key FROM classroom WHERE id = ?", [classId]);
    return result ? result.key : null;
}

function getClassPermissionLevelForUser(classUser, classroom) {
    if (!classUser) {
        return GUEST_PERMISSIONS;
    }

    const userScopes = getUserScopes(classUser, classroom);
    return computeClassPermissionLevel(userScopes.class, {
        isOwner: isClassOwner(classUser, classroom),
        globalScopes: userScopes.global,
    });
}

function hasClassPermissionLevel(classUser, classroom, minimumLevel) {
    return getClassPermissionLevelForUser(classUser, classroom) >= minimumLevel;
}

function findAvailableRoleByPermissionLevel(classroom, permissionLevel) {
    if (!classroom || !Array.isArray(classroom.availableRoles)) {
        return null;
    }

    return classroom.availableRoles.find((role) => computeClassPermissionLevel(role.scopes) === permissionLevel) || null;
}

/**
 * Validates a classroom name
 * @param {string} className - The classroom name to validate
 * @returns {{valid: boolean, error?: string}} Returns validation result with error message if invalid
 */
function validateClassroomName(className) {
    if (!className || typeof className !== "string") {
        return { valid: false, error: "Classroom name is required" };
    }

    const trimmedName = className.trim();

    // Regex validates: 3-30 chars, no consecutive spaces, allowed chars only
    const validPattern = /^(?!.*\s{2})[a-zA-Z0-9\s\-_.'()&,]{3,30}$/;

    if (!validPattern.test(trimmedName)) {
        if (trimmedName.length === 0) {
            return { valid: false, error: "Classroom name cannot be empty" };
        }
        if (trimmedName.length < 3) {
            return { valid: false, error: "Classroom name must be at least 3 characters long" };
        }
        if (trimmedName.length > 100) {
            return { valid: false, error: "Classroom name must be 100 characters or less" };
        }
        return {
            valid: false,
            error: "Classroom name contains invalid characters. Only letters, numbers, spaces, and common punctuation (- _ . ' ( ) & ,) are allowed",
        };
    }

    return { valid: true };
}

/**
 * Normalizes classroom data fetched from database
 * Parses JSON fields and normalizes tags and poll history
 * @param {Object} classroom - The classroom object from database
 * @returns {Object} The normalized classroom object (mutates in place)
 */
function normalizeClassroomData(classroom) {
    // Normalize tags to array
    if (classroom.tags) {
        classroom.tags = classroom.tags.split(",");
    } else {
        classroom.tags = [];
    }

    return classroom;
}

/**
 * Creates a new classroom with the given name and owner
 * @async
 * @param {string} className - The name of the class to create
 * @param {number} ownerId - The ID of the user creating the class
 * @param {string} ownerEmail - The email of the user creating the class
 * @returns {Promise<{classId: number, key: string, className: string}>} Returns an object with class details on success
 * @throws {ValidationError} Throws if the classroom name is invalid
 * @throws {Error} Throws if class creation fails
 */
async function createClass(className, ownerId, ownerEmail) {
    // Validate classroom name
    const validation = validateClassroomName(className);
    if (!validation.valid) {
        throw new ValidationError(validation.error);
    }

    const key = generateKey(4);

    // Add classroom to the database
    const insertResult = await dbRun("INSERT INTO classroom(name, owner, key, tags) VALUES(?, ?, ?, ?)", [className, ownerId, key, null]);

    // Use the ID of the newly created classroom returned by dbRun
    const classId = insertResult;
    if (!classId) {
        throw new AppError("Class was not created successfully", { event: "class.create.failed", reason: "db_insert_failed", className, ownerId });
    }

    await addDefaultClassRoles(classId);

    const classroom = {
        id: classId,
        name: className,
        key: key,
        tags: null,
    };

    // Initialize the classroom in memory
    await initializeClassroom(classroom.id);

    return {
        classId: classroom.id,
        key: classroom.key,
        className: classroom.name,
    };
}

/**
 * Initializes a classroom in memory
 * Fetches all necessary data from the database and creates/updates the classroom in memory
 * @private
 * @param {number} id - The class ID to initialize
 * @returns {Promise<void>}
 */
async function initializeClassroom(id) {
    // Fetch classroom data from database
    const classroom = await dbGet("SELECT id, name, key, owner, tags FROM classroom WHERE id = ?", [id]);

    if (!classroom) {
        throw new NotFoundError(`Class with id ${id} does not exist`);
    }

    // Normalize classroom data (JSON parsing, tags, poll history)
    normalizeClassroomData(classroom);

    // Create or update classroom in memory
    const customRoles = await loadCustomRoles(id);
    const availableRoles = await getClassRoles(id);
    if (!classStateStore.getClassroom(id)) {
        classStateStore.setClassroom(
            id,
            new Classroom({
                id,
                className: classroom.name,
                key: classroom.key,
                owner: classroom.owner,
                tags: classroom.tags,
                customRoles,
                availableRoles,
            })
        );
    } else {
        classStateStore.getClassroom(id).tags = classroom.tags;
        classStateStore.getClassroom(id).customRoles = customRoles;
        classStateStore.getClassroom(id).availableRoles = availableRoles;
    }

    // Get all students in the class and add them to the classroom
    const classStudents = await getStudentsInClass(id);
    for (const studentEmail in classStudents) {
        // If the student is already in the class, skip
        if (classStateStore.getClassroomStudent(id, studentEmail)) continue;

        const student = classStudents[studentEmail];

        // Normalize student.tags to an array of strings
        if (!Array.isArray(student.tags)) {
            if (typeof student.tags === "string" && student.tags.trim() !== "") {
                student.tags = student.tags
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean);
            } else {
                student.tags = [];
            }
        }

        // Ensure 'Offline' is present exactly once at the front
        if (!student.tags.includes("Offline")) {
            student.tags.unshift("Offline");
        }

        student.displayName = student.displayName || student.email;
        classStateStore.setUser(studentEmail, student);
        classStateStore.setClassroomStudent(id, studentEmail, student);
    }
}

/**
 * Starts a class session by activating the class, emitting the start class event,
 * and updating the class state in memory and to connected clients.
 * @param {string|number} classId - The ID of the class to start.
 */
async function startClass(classId) {
    await advancedEmitToClass("startClassSound", classId, { api: true });

    // Activate the class and send the class active event
    classStateStore.getClassroom(classId).isActive = true;
    advancedEmitToClass("isClassActive", classId, {}, classStateStore.getClassroom(classId).isActive);
}

/**
 * Ends a class session by deactivating the class, emitting the end class event,
 * and updating the class state in memory and to connected clients.
 * @param {string|number} classId - The ID of the class to end.
 * @param {Object} [userSession] - The session object of the user ending the class.
 */
async function endClass(classId, userSession) {
    await advancedEmitToClass("endClassSound", classId, { api: true });

    // Deactivate the class and send the class active event
    classStateStore.getClassroom(classId).isActive = false;
    await clearPoll(classId, userSession, true);

    advancedEmitToClass("isClassActive", classId, {}, classStateStore.getClassroom(classId).isActive);
}

/**
 * Internal function to add a user to a classroom session in memory.
 * Does not perform authorization checks - caller must validate permissions.
 * @private
 * @param {number} classId - The class ID
 * @param {string} email - User's email
 * @param {Object} sessionUser - The user's session object
 * @returns {Promise<boolean>} Returns true if successful
 */
async function addUserToClassroomSession(classId, email, sessionUser) {
    // Find the user
    let user = await dbGet("SELECT id FROM users WHERE email=?", [email]);

    if (!user && !classStateStore.getUser(email)) {
        throw new NotFoundError("User is not in database");
    } else if (classStateStore.getUser(email) && classStateStore.getUser(email).isGuest) {
        user = classStateStore.getUser(email);
    }

    // Get the class-user relationship if the user is not a guest
    let classUser;
    if (!user.isGuest) {
        classUser = await dbGet("SELECT * FROM classusers WHERE classId=? AND studentId=?", [classId, user.id]);
    }

    // Get the classroom from database to check ownership
    const classroomDb = await dbGet("SELECT owner FROM classroom WHERE id=?", [classId]);
    if (!classroomDb) {
        throw new NotFoundError("Class not found");
    }

    // If the user is the owner of the classroom, ensure they have a classUser entry
    if (classroomDb.owner === user.id) {
        if (!classUser) {
            classUser = { tags: "" };
        }
    }

    if (classUser) {
        // Get the student's session data
        let currentUser = classStateStore.getUser(email);
        const classroom = classStateStore.getClassroom(classId);

        // Load multi-role assignments from user_roles
        const roleAssignments = await getStudentRoleAssignments(classId, currentUser.id);
        const roleRefs = buildRoleReferences(roleAssignments);
        currentUser.roles = { global: currentUser.roles?.global || [], class: roleRefs };
        currentUser.isClassOwner = classroomDb.owner === user.id;

        // If the user is banned, don't let them join
        if (getClassPermissionLevelForUser(currentUser, classroom) === BANNED_PERMISSIONS && !currentUser.isClassOwner) {
            throw new ForbiddenError("You are banned from that class");
        }
        currentUser.activeClass = classId;

        // Load tags from classusers table
        currentUser.tags = classUser.tags ? classUser.tags.split(",").filter(Boolean) : [];
        currentUser.tags = currentUser.tags.filter((tag) => tag !== "Offline");
        classStateStore.getUser(email).tags = currentUser.tags;

        // Add the student to the class
        classStateStore.setClassroomStudent(classId, email, currentUser);

        // Set the active class of the user
        classStateStore.getUser(email).activeClass = classId;
        advancedEmitToClass("joinSound", classId, {});

        // Set session class and classId
        sessionUser.classId = classId;

        // Set the class of the API socket
        setClassOfApiSockets(currentUser.API, classId);

        // Move all user sockets (session-based and JWT-based) to the new class room
        // This ensures sockets receive classUpdate emissions when joining via HTTP
        setClassOfUserSockets(email, classId);

        // Call classUpdate on all user's tabs
        userUpdateSocket(email, "classUpdate", classId, { global: false, restrictToControlPanel: true });
        return true;
    } else {
        // If the user is not a guest, insert them into the database
        if (!user.isGuest) {
            await dbRun("INSERT INTO classusers(classId, studentId) VALUES(?, ?)", [classId, user.id]);
        }

        // Grab the user from the users list
        const classData = classStateStore.getClassroom(classId);
        let currentUser = classStateStore.getUser(email);
        const isOwner = currentUser.id === classData.owner;
        currentUser.roles = { global: currentUser.roles?.global || [], class: [] };
        currentUser.isClassOwner = isOwner;
        currentUser.activeClass = classId;
        currentUser.tags = [];

        // Add the student to the class
        classStateStore.setClassroomStudent(classId, email, currentUser);

        classStateStore.getUser(email).activeClass = classId;

        setClassOfApiSockets(currentUser.API, classId);

        // Move all user sockets (session-based and JWT-based) to the new class room
        // This ensures sockets receive classUpdate emissions when joining via HTTP
        setClassOfUserSockets(email, classId);

        // Call classUpdate on all user's tabs
        userUpdateSocket(email, "classUpdate", classId, { global: false, restrictToControlPanel: true });
        return true;
    }
}

/**
 * Allows a user to join a class by classId or class key.
 * @param {Object} userData - The session object of the user attempting to join.
 * @param {string|number} classId - The ID or key of the class to join.
 * @returns {Promise<boolean>} Returns true if joined successfully.
 */
async function joinClass(userData, classId) {
    const email = userData.email;
    requireInternalParam(classId, "classId");
    requireInternalParam(email, "email");

    // Convert class key to ID if necessary
    const dbClassroom = await dbGet("SELECT * FROM classroom WHERE key=? OR id=?", [classId, classId]);
    if (!dbClassroom) {
        throw new NotFoundError("Class not found");
    }

    // Use the class ID from the database
    classId = dbClassroom.id;

    if (userData.activeClass === classId) {
        throw new ValidationError("You are already in that class");
    }

    // Check if the user is in the class to prevent people from joining classes just from the class ID
    const studentId = await getIdFromEmail(email);
    const classUsers = await dbGet("SELECT * FROM classusers WHERE studentId=? AND classId=?", [studentId, classId]);
    const classroomOwner = await dbGet("SELECT owner FROM classroom WHERE id=?", [classId]);
    const isGuest = !!classStateStore.getUser(email)?.isGuest;

    // User must either be in classusers table or be the owner of the classroom (global guests bypass enrollment)
    if (!isGuest && !classUsers && (!classroomOwner || classroomOwner.owner !== studentId)) {
        throw new ForbiddenError("You are not in that class");
    }

    // Initialize classroom if not already loaded
    if (!classStateStore.getClassroom(classId)) {
        await initializeClassroom(classId);
    }

    // Add user to classroom session
    const response = await addUserToClassroomSession(classId, email, userData);

    // Update all user sockets with the new class
    const userSockets = socketStateStore.getUserSocketsByEmail(email);
    if (response === true && userSockets) {
        for (const userSocket of Object.values(userSockets)) {
            userSocket.request.session.classId = classId;
            userSocket.request.session.save();
            userSocket.emit("joinClass", response);
        }
    }
}

/**
 * Removes a user from a class session.
 * Kicks the user from the classroom if they are a guest, or from the session otherwise.
 * Emits leave sound and updates the class state.
 * @param {Object} userData - The session object of the user leaving the class.
 * @param {number} [classId] - The ID of the class to leave. If not provided, uses the user's active class.
 * @returns {boolean} True if the user was removed successfully, false otherwise.
 */
async function leaveClass(userData, classId) {
    // If no classId is provided, use the user's active class
    if (!classId) {
        classId = userData.activeClass;
    }

    const email = userData.email;
    const user = classStateStore.getUser(email);
    if (!user || user.activeClass !== classId) {
        throw new NotFoundError("User is not in the specified class");
    }

    // Kick the user from the classroom entirely if they're a guest
    // If not, kick them from the session
    await advancedEmitToClass("leaveSound", classId, {});
    await classKickStudent(user.id, classId, { exitRoom: classStateStore.getUser(email).isGuest });
    return true;
}

/**
 * Checks if the class with the given classId is currently active.
 * @param {number} classId - The ID of the class to check.
 * @returns {boolean} True if the class is active, false otherwise.
 */
function isClassActive(classId) {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) {
        return false;
    }

    return classroom.isActive;
}

/**
 * Deletes all classrooms owned by the specified user, along with related data
 * (class users, polls, links) and in-memory session state.
 * @param {number|string} userId - The ID of the user whose classrooms should be deleted.
 */
async function deleteClassrooms(userId) {
    const classrooms = await dbGetAll("SELECT * FROM classroom WHERE owner=?", userId);
    if (classrooms.length == 0) return;

    await dbRun("DELETE FROM classroom WHERE owner=?", classrooms[0].owner);
    for (const classroom of classrooms) {
        if (classStateStore.getClassroom(classroom.id)) {
            await endClass(classroom.id);
        }

        await Promise.all([
            dbRun("DELETE FROM classusers WHERE classId=?", classroom.id),
            dbRun("DELETE FROM class_polls WHERE classId=?", classroom.id),
            dbRun("DELETE FROM links WHERE classId=?", classroom.id),
        ]);
        invalidateClassPollCache(classroom.id);
        classCodeCacheStore.invalidateByClassId(classroom.id);
    }
}

// Kick

/**
 * Kicks a student from a class.
 * If exitRoom is true, fully removes them; otherwise just removes from session.
 */
async function classKickStudent(userId, classId, options = { exitRoom: true, ban: false }) {
    try {
        const email = await getEmailFromId(userId);
        const classroom = classStateStore.getClassroom(classId);

        const existingUser = classStateStore.getUser(email);
        if (existingUser) {
            const user = existingUser;
            user.activeClass = null;
            user.break = false;
            user.help = false;

            if (options.ban) {
                const blockedRole = findAvailableRoleByPermissionLevel(classroom, BANNED_PERMISSIONS);
                user.roles = {
                    global: user.roles?.global || [],
                    class: blockedRole ? buildRoleReferences([blockedRole]) : [],
                };
            }
            setClassOfApiSockets(existingUser.API, null);
        }

        const classroomStudent = classroom ? classroom.students[email] : null;
        if (classroom && classroomStudent) {
            const student = classroomStudent;
            student.activeClass = null;
            student.break = false;
            student.help = false;
            student.tags = ["Offline"];
            if (classStateStore.getUser(email)) {
                classStateStore.setUser(email, student);
            }

            if (student.isGuest) {
                classStateStore.removeClassroomStudent(classId, email);
            }
        }

        if (options.exitRoom && classroom) {
            const userObj = classStateStore.getUser(email);
            if (userObj && !userObj.isGuest && !options.ban) {
                await dbRun("DELETE FROM classusers WHERE studentId=? AND classId=?", [userObj.id, classId]);
                classStateStore.removeClassroomStudent(classId, email);
            }
        }

        const classOwner = await dbGet("SELECT owner FROM classroom WHERE id=?", [classId]);
        if (classOwner) {
            const ownerEmail = await getEmailFromId(classOwner.owner);
            userUpdateSocket(ownerEmail, "classUpdate", classId);
        }

        const usersSockets = socketStateStore.getUserSocketsByEmail(email);
        if (usersSockets) {
            for (const userSocket of Object.values(usersSockets)) {
                userSocket.leave(`class-${classId}`);
                userSocket.request.session.classId = null;
                userSocket.request.session.save();
                userSocket.emit("reload");
            }
        }
    } catch (err) {}
}

/**
 * Kicks all non-teacher students from a class.
 */
async function classKickStudents(classId) {
    try {
        const classroom = classStateStore.getClassroom(classId);
        if (!classroom) return;

        const kickOperations = [];
        for (const student of Object.values(classroom.students)) {
            if (hasClassPermissionLevel(student, classroom, TEACHER_PERMISSIONS)) {
                continue;
            }

            kickOperations.push(classKickStudent(student.id, classId));
        }

        if (kickOperations.length > 0) {
            await Promise.all(kickOperations);
        }
    } catch (err) {}
}

/**
 * Regenerates the classroom join code and updates cache/state.
 * @param {number|string} classId
 * @returns {Promise<string>} The new classroom code.
 */
async function regenerateClassCode(classId) {
    requireInternalParam(classId, "classId");

    const classroom = await dbGet("SELECT key FROM classroom WHERE id = ?", [classId]);
    if (!classroom) {
        throw new NotFoundError("Classroom not found");
    }

    const accessCode = generateKey(4);
    await dbRun("UPDATE classroom SET key=? WHERE id=?", [accessCode, classId]);

    const loadedClassroom = classStateStore.getClassroom(classId);
    if (loadedClassroom) {
        classStateStore.updateClassroom(classId, { key: accessCode });
    }

    if (classroom.key) {
        classCodeCacheStore.delete(classroom.key);
    }
    classCodeCacheStore.set(accessCode, Number(classId));

    return accessCode;
}

/**
 * Broadcasts a class update using any connected socket in the class.
 * Prefers a specific user's sockets first when provided.
 */
function broadcastClassUpdate(classId, preferredEmail) {
    if (!classId) return false;

    if (preferredEmail && userUpdateSocket(preferredEmail, "classUpdate", classId)) {
        return true;
    }

    const classroom = classStateStore.getClassroom(classId);
    if (!classroom || !classroom.students) {
        return false;
    }

    for (const email of Object.keys(classroom.students)) {
        if (email === preferredEmail) continue;
        if (userUpdateSocket(email, "classUpdate", classId)) {
            return true;
        }
    }

    return false;
}

// Break

/**
 * Requests a break for a student.
 */
function requestBreak(reason, userData) {
    const classId = userData.classId;
    const email = userData.email;
    if (!classStateStore.getClassroom(classId)?.isActive) {
        return "This class is not currently active.";
    }

    const classroom = classStateStore.getClassroom(classId);
    const student = classroom.students[email];
    advancedEmitToClass("breakSound", classId, {});
    student.break = reason;

    broadcastClassUpdate(classId, email);
    return true;
}

/**
 * Approves or denies a break for a student.
 */
async function approveBreak(breakApproval, userId, userData) {
    const email = await getEmailFromId(userId);

    const classId = userData.classId;
    const student = classStateStore.getClassroomStudent(classId, email);
    classStateStore.updateClassroomStudent(classId, email, { break: breakApproval });

    io.to(`user-${email}`).emit("break", breakApproval);
    if (student && student.API) {
        io.to(`api-${student.API}`).emit("break", breakApproval);
    }
    broadcastClassUpdate(classId, userData.email || email);
    return true;
}

/**
 * Ends a student's active break.
 */
function endBreak(userData) {
    const email = userData.email;
    const classId = userData.classId;
    const student = classStateStore.getClassroomStudent(classId, email);
    classStateStore.updateClassroomStudent(classId, userData.email, { break: false });

    io.to(`user-${email}`).emit("break", false);
    if (student && student.API) {
        io.to(`api-${student.API}`).emit("break", false);
    }
    broadcastClassUpdate(classId, email);
}

// Help

/**
 * Sends a help ticket for a student.
 */
function sendHelpTicket(reason, userSession) {
    const classId = userSession.classId;
    const email = userSession.email;
    if (!classStateStore.getClassroom(classId)?.isActive) {
        return "This class is not currently active.";
    }

    const student = classStateStore.getClassroomStudent(classId, email);
    if (student.help.reason === reason) {
        return "You have already requested help for this reason.";
    }

    const time = Date.now();
    classStateStore.updateClassroomStudent(classId, email, { help: { reason: reason, time: time } });

    emitToUser(email, "helpSuccess");
    advancedEmitToClass("helpSound", classId, {});

    broadcastClassUpdate(classId, email);
    return true;
}

/**
 * Deletes a help ticket for a student.
 */
async function deleteHelpTicket(studentId, userData) {
    const classId = userData.classId;
    const email = userData.email;
    const studentEmail = await getEmailFromId(studentId);

    classStateStore.updateClassroomStudent(classId, studentEmail, { help: false });

    broadcastClassUpdate(classId, email);
    return true;
}

// Tags

/**
 * Sets the allowed tags for a class and normalizes existing student tags.
 */
async function setTags(tags, userSession) {
    if (!Array.isArray(tags)) return;

    tags = tags
        .filter((tag) => typeof tag === "string")
        .map((tag) => tag.trim())
        .map((tag) => tag.replace(/[\r\n\t]/g, ""))
        .filter((tag) => tag !== "")
        .sort();
    if (!tags.includes("Offline")) tags.push("Offline");

    const classId = userSession.classId;
    const classroom = classStateStore.getClassroom(classId);
    if (!classId || !classroom) return;
    classStateStore.updateClassroom(classId, { tags });

    for (const student of Object.values(classroom.students)) {
        const permissionLevel = getClassPermissionLevelForUser(student, classroom);
        if (permissionLevel === BANNED_PERMISSIONS || permissionLevel === MANAGER_PERMISSIONS) continue;
        if (!student.tags) student.tags = [];

        let studentTags = [];
        studentTags = student.tags.filter(Boolean);
        studentTags = studentTags.filter((tag) => tags.includes(tag));
        student.tags = studentTags;

        try {
            await dbRun("UPDATE classusers SET tags = ? WHERE studentId = ? AND classId = ?", [studentTags.join(","), student.id, classId]);
        } catch (err) {}
    }

    await dbRun("UPDATE classroom SET tags = ? WHERE id = ?", [tags.toString(), classId]);
}

/**
 * Saves the tags for a specific student in the class.
 */
async function saveTags(studentId, tags, userSession) {
    const email = await getEmailFromId(studentId);
    if (!Array.isArray(tags)) return;

    const isActiveInClass = classStateStore.getUser(email) && classStateStore.getUser(email).activeClass === userSession.classId;
    let normalized = tags
        .filter((tag) => typeof tag === "string")
        .map((tag) => tag.trim())
        .map((tag) => tag.replace(/[\r\n\t]/g, ""))
        .filter((tag) => tag !== "");

    if (isActiveInClass) {
        normalized = normalized.filter((tag) => tag !== "Offline");
    } else if (!normalized.includes("Offline")) {
        normalized.push("Offline");
    }

    normalized = normalized.filter((tag) => tag !== "Offline");

    const student = classStateStore.getClassroom(userSession.classId)?.students[email];
    if (!student) return;
    const oldTags = student.tags || [];

    classStateStore.updateClassroomStudent(userSession.classId, email, { tags: normalized });

    const wasExcluded = oldTags.includes("Excluded");
    const isNowExcluded = normalized.includes("Excluded");

    if (!wasExcluded && isNowExcluded && student.pollRes) {
        student.pollRes.buttonRes = "";
        student.pollRes.textRes = "";
        student.pollRes.date = null;
    }

    await dbRun("UPDATE classusers SET tags = ? WHERE studentId = ? AND classId = ?", [normalized.join(","), studentId, userSession.classId]);
}

// Class Users

/**
 * Gets the users of a class, merging in-memory session data with DB data.
 * @param {Object} user - The requesting user (used for permission-based filtering).
 * @param {string} key - The class key/code.
 */
async function getClassUsers(user, key) {
    const dbClassUsers = await new Promise((resolve, reject) => {
        database.all(
            "SELECT DISTINCT users.id, users.email FROM users INNER JOIN classroom ON classroom.key = ? LEFT JOIN classusers ON users.id = classusers.studentId AND classusers.classId = classroom.id WHERE users.id = classroom.owner OR classusers.studentId IS NOT NULL",
            [key],
            (err, rows) => {
                if (err) return reject(err);
                if (!rows) return resolve({ error: "class does not exist" });
                resolve(rows);
            }
        );
    });

    if (dbClassUsers.error) return dbClassUsers;

    let classUsers = {};
    let cDClassUsers = {};
    let classId = await getClassIDFromCode(key);

    const cdClassroom = classId ? classStateStore.getClassroom(classId) : null;
    const requesterPermissionLevel = cdClassroom ? getClassPermissionLevelForUser(user, cdClassroom) : GUEST_PERMISSIONS;
    if (cdClassroom) {
        cDClassUsers = cdClassroom.students || {};
    }

    for (let userRow of dbClassUsers) {
        classUsers[userRow.email] = {
            loggedIn: false,
            ...userRow,
            help: null,
            break: null,
            pogMeter: 0,
        };

        let cdUser = cDClassUsers[userRow.email];
        if (cdUser) {
            classUsers[userRow.email].loggedIn = true;
            classUsers[userRow.email].help = cdUser.help;
            classUsers[userRow.email].break = cdUser.break;
            classUsers[userRow.email].pogMeter = cdUser.pogMeter;
            classUsers[userRow.email].roles = {
                global: classUsers[userRow.email].roles?.global || [],
                class: cdUser.roles?.class || [],
            };
        }

        if (requesterPermissionLevel < TEACHER_PERMISSIONS) {
            if (classUsers[userRow.email].help) {
                classUsers[userRow.email].help = true;
            }
            if (typeof classUsers[userRow.email].break == "string") {
                classUsers[userRow.email].break = false;
            }
        }

        if (requesterPermissionLevel < MOD_PERMISSIONS) {
            delete classUsers[userRow.email].help;
            delete classUsers[userRow.email].break;
            delete classUsers[userRow.email].pogMeter;
        }
    }

    return classUsers;
}

// Timer

function getTimer(classId) {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return;

    return classroom.timer;
}

function startTimer({ classId, duration, sound }) {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return;

    const startTime = Date.now();
    const endTime = startTime + duration;

    classStateStore.updateClassroom(classId, {
        timer: {
            startTime,
            endTime,
            active: true,
            sound: sound ?? false,
        },
    });

    broadcastClassUpdate(classId);
}

function resumeTimer(classId) {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return;

    const timer = classroom.timer;
    // Ensure there is a timer to resume
    if (!timer) return;
    // Only resume if the timer is currently inactive/paused
    if (timer.active) return;
    const pausedAt = timer.pausedAt;
    // Ensure pausedAt is a finite number before resuming
    if (typeof pausedAt !== "number" || !Number.isFinite(pausedAt)) return;
    // Ensure startTime and endTime are finite numbers to avoid NaN
    if (
        typeof timer.startTime !== "number" ||
        !Number.isFinite(timer.startTime) ||
        typeof timer.endTime !== "number" ||
        !Number.isFinite(timer.endTime)
    )
        return;
    const now = Date.now();
    const pauseDelta = now - pausedAt;

    classStateStore.updateClassroom(classId, {
        timer: {
            ...timer,
            startTime: timer.startTime + pauseDelta,
            endTime: timer.endTime + pauseDelta,
            active: true,
            // Clear pausedAt so subsequent resumes do not re-shift the timer
            pausedAt: undefined,
        },
    });

    broadcastClassUpdate(classId);
}

function pauseTimer(classId) {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return;

    const timer = classroom.timer;
    if (
        !timer ||
        typeof timer.startTime !== "number" ||
        !Number.isFinite(timer.startTime) ||
        typeof timer.endTime !== "number" ||
        !Number.isFinite(timer.endTime)
    ) {
        return;
    }

    classStateStore.updateClassroom(classId, {
        timer: {
            ...timer,
            active: false,
            pausedAt: Date.now(),
        },
    });

    broadcastClassUpdate(classId);
}

function endTimer(classId) {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return;

    classStateStore.updateClassroom(classId, {
        timer: {
            ...(classroom.timer || {}),
            active: false,
        },
    });

    broadcastClassUpdate(classId);
}

function clearTimer(classId) {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return;

    classStateStore.updateClassroom(classId, {
        timer: {
            startTime: 0,
            endTime: 0,
            active: false,
            sound: false,
        },
    });

    broadcastClassUpdate(classId);
}

/**
 * Clears poll votes from students who should be excluded based on class settings,
 * tags, permission levels, break status, and offline status.
 * @param {string|number} classId
 */
function clearVotesFromExcludedStudents(classId) {
    const classData = classStateStore.getClassroom(classId);
    if (!classData) return;

    const excludedEmails = [];

    for (const student of Object.values(classData.students)) {
        let shouldExclude = false;
        const permissionLevel = getClassPermissionLevelForUser(student, classData);

        if (classData.poll && classData.poll.excludedRespondents && classData.poll.excludedRespondents.includes(student.id)) {
            shouldExclude = true;
        }

        if (student.tags && student.tags.includes("Excluded")) {
            shouldExclude = true;
        }

        if (classData.settings && classData.settings.isExcluded) {
            if (classData.settings.isExcluded.guests && permissionLevel === GUEST_PERMISSIONS) {
                shouldExclude = true;
            }
            if (classData.settings.isExcluded.mods && permissionLevel === MOD_PERMISSIONS) {
                shouldExclude = true;
            }
            if (classData.settings.isExcluded.teachers && permissionLevel === TEACHER_PERMISSIONS) {
                shouldExclude = true;
            }
        }

        if (student.break === true) {
            shouldExclude = true;
        }

        if ((student.tags && student.tags.includes("Offline")) || permissionLevel >= TEACHER_PERMISSIONS) {
            shouldExclude = true;
        }

        if (shouldExclude) {
            excludedEmails.push(student.email);
        }
    }

    for (const email of excludedEmails) {
        const student = classData.students[email];
        if (student && student.pollRes) {
            student.pollRes.buttonRes = "";
            student.pollRes.textRes = "";
            student.pollRes.date = null;
        }
    }
}

/**
 * Updates one or more class settings in memory and broadcasts the changes via socket.
 *
 * @param {string|number} classId - The unique identifier of the class.
 * @param {Object} classSettings - Partial object of class settings to update.
 * @returns {Promise<void>} Resolves when the settings have been updated and broadcasted.
 */
async function updateClassSetting(classId, classSettings) {
    requireInternalParam(classId, "classId");
    requireInternalParam(classSettings, "classSettings");

    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) {
        throw new NotFoundError("Class not started");
    }

    // When more settings are added, this should be refactored
    const newClassName = classSettings.name;
    if (newClassName != null) {
        if (typeof newClassName !== "string") {
            throw new ValidationError("The new class name must be a string");
        }

        const normalizedName = newClassName.trim();
        const validation = validateClassroomName(normalizedName);
        if (!validation.valid) {
            throw new ValidationError(validation.error);
        }

        await dbRun("UPDATE classroom SET name = ? WHERE id = ?", [normalizedName, classId]);
        classStateStore.updateClassroom(classId, { className: normalizedName });
        broadcastClassUpdate(classId);
        return;
    }

    throw new ValidationError("Invalid setting provided.");
}

module.exports = {
    getUserJoinedClasses,
    getClassCode,
    getClassLinks,
    validateClassroomName,
    initializeClassroom,
    addUserToClassroomSession,
    createClass,
    startClass,
    endClass,
    joinClass,
    leaveClass,
    isClassActive,
    deleteClassrooms,
    classKickStudent,
    classKickStudents,
    requestBreak,
    approveBreak,
    endBreak,
    sendHelpTicket,
    deleteHelpTicket,
    setTags,
    saveTags,
    getClassUsers,
    getTimer,
    startTimer,
    endTimer,
    clearTimer,
    resumeTimer,
    pauseTimer,
    clearVotesFromExcludedStudents,
    updateClassSetting,
    regenerateClassCode,
    broadcastClassUpdate,
};
