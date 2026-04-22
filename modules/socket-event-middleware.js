const { classStateStore } = require("@services/classroom-service");
const { dbGet } = require("@modules/database");
const { getUserDataFromDb } = require("@services/user-service");
const { userHasScope } = require("@modules/scope-resolver");
const { handleSocketError } = require("@modules/socket-error-handler");
const AuthError = require("@errors/auth-error");
const ForbiddenError = require("@errors/forbidden-error");
const ValidationError = require("@errors/validation-error");

function normalizeClassId(raw) {
    if (raw === undefined || raw === null || raw === "") {
        return raw;
    }

    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
}

function saveSession(session) {
    if (!session || typeof session.save !== "function") {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        session.save(() => resolve());
    });
}

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

function createSocketContext(socket, event, args) {
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

function getDeniedMessage(message, fallback) {
    return message || fallback;
}

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

function onSocketEvent(socket, event, ...middlewaresAndHandler) {
    const handler = middlewaresAndHandler.pop();
    const middlewares = middlewaresAndHandler;

    socket.on(event, async (...args) => {
        const socketContext = createSocketContext(socket, event, args);

        try {
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
