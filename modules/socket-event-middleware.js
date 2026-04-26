const { classStateStore } = require("@services/classroom-service");
const { dbGet } = require("@modules/database");
const { getUserDataFromDb } = require("@services/user-service");
const { userHasScope } = require("@modules/scope-resolver");
const { handleSocketError } = require("@modules/socket-error-handler");
const { getLogger, logEvent } = require("@modules/logger");
const AuthError = require("@errors/auth-error");
const ForbiddenError = require("@errors/forbidden-error");
const ValidationError = require("@errors/validation-error");

/**
 * Coerce class identifiers into numeric IDs when possible so socket session state stays aligned with DB values.
 *
 * @param {*} raw - raw.
 * @returns {*}
 */
function normalizeClassId(raw) {
    if (raw === undefined || raw === null || raw === "") {
        return raw;
    }

    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
}

/**
 * Persist session changes after socket middleware updates class-related state.
 *
 * @param {*} session - session.
 * @returns {*}
 */
function saveSession(session) {
    if (!session || typeof session.save !== "function") {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        session.save(() => resolve());
    });
}

/**
 * Resolve the active user from memory first, then fall back to the database when needed.
 *
 * @param {import("socket.io").Socket} socket - socket.
 * @param {*} email - email.
 * @returns {Promise<*>}
 */
async function getSocketUserData(socket, email) {
    const cachedUser = classStateStore.getUser(email);
    if (cachedUser) {
        return cachedUser;
    }

    const sessionUserId = socket.request.session?.userId;
    if (sessionUserId != null) {
        return getUserDataFromDb(sessionUserId);
    }

    if (!email) {
        return null;
    }

    const userRow = await dbGet("SELECT id FROM users WHERE email=?", [email]);
    return userRow ? getUserDataFromDb(userRow.id) : null;
}

/**
 * Build a lazily-resolved event context so socket guards can inspect user, class, and session state.
 *
 * @param {import("socket.io").Socket} socket - socket.
 * @param {*} event - event.
 * @param {*} args - args.
 * @returns {Promise<*>}
 */
async function createSocketContext(socket, event, args) {
    const logger = await getLogger();
    const baseMeta = {
        socketId: socket.id,
        event: event,
        ip: socket.handshake?.address || socket.request?.socket?.remoteAddress,
        session: JSON.stringify(socket.request.session),
    };

    socket.logger = logger.child(baseMeta);
    socket.logEvent = (...logArgs) => logEvent(socket.logger, ...logArgs);
    socket.infoEvent = (...logArgs) => socket.logEvent("info", ...logArgs);
    socket.warnEvent = (...logArgs) => socket.logEvent("warn", ...logArgs);
    socket.errorEvent = (...logArgs) => socket.logEvent("error", ...logArgs);

    return {
        socket,
        socketUpdates: socket._socketUpdates,
        event,
        args,
        session: socket.request.session,
        user: undefined,
        classId: undefined,
        classroom: undefined,
        classUser: undefined,

        async resolveUser() {
            if (this.user !== undefined) {
                return this.user;
            }

            const email = this.session?.email;
            this.user = await getSocketUserData(this.socket, email);
            return this.user;
        },

        async resolveClassId() {
            if (this.classId !== undefined) {
                return this.classId;
            }

            const user = await this.resolveUser();
            const resolvedClassId = normalizeClassId(user?.activeClass != null ? user.activeClass : this.session?.classId);

            if (this.session && normalizeClassId(this.session.classId) !== resolvedClassId) {
                this.session.classId = resolvedClassId ?? null;
                await saveSession(this.session);
            }

            this.classId = resolvedClassId;
            return this.classId;
        },

        async resolveClassroom() {
            if (this.classroom !== undefined) {
                return this.classroom;
            }

            const classId = await this.resolveClassId();
            this.classroom = classId === undefined || classId === null || classId === "" ? null : classStateStore.getClassroom(classId) || null;
            return this.classroom;
        },

        async resolveClassUser() {
            if (this.classUser !== undefined) {
                return this.classUser;
            }

            const [user, classroom] = await Promise.all([this.resolveUser(), this.resolveClassroom()]);
            const email = this.session?.email;
            if (!classroom || !email) {
                this.classUser = null;
                return this.classUser;
            }

            this.classUser =
                classroom.students[email] ||
                (user && Number(classroom.owner) === Number(user.id)
                    ? {
                          ...user,
                          isClassOwner: true,
                      }
                    : null);

            return this.classUser;
        },
    };
}

/**
 * Prefer the explicit denial message when one was supplied by the caller.
 *
 * @param {*} message - message.
 * @param {*} fallback - fallback.
 * @returns {*}
 */
function getDeniedMessage(message, fallback) {
    return message || fallback;
}

/**
 * Build a socket guard that rejects users who do not have the required global scope.
 *
 * @param {*} scope - scope.
 * @param {*} message - message.
 * @returns {boolean}
 */
function hasScope(scope, message) {
    return async function (socketContext) {
        const user = await socketContext.resolveUser();

        if (!user || !socketContext.session?.email) {
            throw new AuthError("User is not authenticated", { event: "permission.check.failed", reason: "not_authenticated" });
        }

        if (userHasScope(user, scope)) {
            return;
        }

        throw new ForbiddenError(getDeniedMessage(message, "You do not have permission to access this resource."), {
            event: "permission.check.failed",
            reason: "insufficient_scope",
            scope,
        });
    };
}

/**
 * Build a socket guard that verifies class membership and class-specific scope access.
 *
 * @param {*} scope - scope.
 * @param {*} message - message.
 * @returns {boolean}
 */
function hasClassScope(scope, message) {
    return async function (socketContext) {
        const user = await socketContext.resolveUser();

        if (!user || !socketContext.session?.email) {
            throw new AuthError("User is not authenticated", { event: "permission.check.failed", reason: "not_authenticated" });
        }

        const classId = await socketContext.resolveClassId();
        if (classId === undefined || classId === null || classId === "") {
            throw new ValidationError("Class ID is required.", { event: "permission.check.failed", reason: "class_id_required" });
        }

        const classroom = await socketContext.resolveClassroom();
        if (!classroom) {
            throw new ForbiddenError("This class is not currently active.", { event: "permission.check.failed", reason: "class_not_active" });
        }

        const classUser = await socketContext.resolveClassUser();
        if (!classUser) {
            throw new ForbiddenError("User not found in this class.", { event: "permission.check.failed", reason: "user_not_in_class" });
        }

        if (userHasScope(classUser, scope, classroom)) {
            return;
        }

        throw new ForbiddenError(getDeniedMessage(message, "Insufficient class permissions."), {
            event: "permission.check.failed",
            reason: "insufficient_class_scope",
            scope,
        });
    };
}

/**
 * Register a socket event with middleware execution and shared error handling.
 *
 * @param {import("socket.io").Socket} socket - socket.
 * @param {*} event - event.
 * @param {...*} middlewaresAndHandler - middlewaresAndHandler.
 * @returns {*}
 */
function onSocketEvent(socket, event, ...middlewaresAndHandler) {
    const handler = middlewaresAndHandler.pop();
    const middlewares = middlewaresAndHandler;

    socket.on(event, async (...args) => {
        try {
            const socketContext = await createSocketContext(socket, event, args);

            for (const middleware of middlewares) {
                await middleware(socketContext, ...args);
            }

            await handler(socketContext, ...args);
        } catch (err) {
            const customMessage = err?.isOperational ? err.message : undefined;
            await handleSocketError(err, socket, event, customMessage);
        }
    });
}

module.exports = {
    onSocketEvent,
    hasScope,
    hasClassScope,
};
