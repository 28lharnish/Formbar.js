const { classStateStore } = require("@services/classroom-service");
const { dbGet, dbGetAll } = require("@modules/database");
const { compare } = require("@modules/crypto");
const { userHasScope } = require("@modules/scope-resolver");
const { createStudentFromUserData } = require("@services/student-service");
const { getUserDataFromDb } = require("@services/user-service");
const { isAuthenticated } = require("@middleware/authentication");
const AuthError = require("@errors/auth-error");
const ForbiddenError = require("@errors/forbidden-error");
const NotFoundError = require("@errors/not-found-error");
const ValidationError = require("@errors/validation-error");
const DIGIPOG_HTTP_API_PATH = /^\/api(?:\/v\d+)?\/digipogs(?:\/|$|\?)/i;

/** Express path params are strings; in-memory classrooms are keyed by numeric id from the DB. */
function normalizeClassId(raw) {
    if (raw === undefined || raw === null || raw === "") {
        return raw;
    }
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
}

function isDigipogHttpApiRequest(req) {
    return DIGIPOG_HTTP_API_PATH.test(req.originalUrl || req.baseUrl || req.path || "");
}

async function attachDigipogPinUser(req, res) {
    if (!isDigipogHttpApiRequest(req) || req.user?.email) {
        return;
    }

    const hasStandardAuth = Boolean(req.headers.authorization || req.headers.api || req.query.api || req.body?.api);
    if (hasStandardAuth) {
        await isAuthenticated(req, res, () => {});
    }

    if (!req.body?.pin || req.user?.email) {
        return;
    }

    const pin = String(req.body.pin);
    const users = await dbGetAll("SELECT id, pin FROM users WHERE pin IS NOT NULL");
    let matchedUserId = null;

    for (const candidate of users) {
        if (!candidate.pin || !(await compare(pin, candidate.pin))) {
            continue;
        }

        if (matchedUserId && matchedUserId !== candidate.id) {
            return;
        }

        matchedUserId = candidate.id;
    }

    if (!matchedUserId) {
        return new AuthError("Invalid PIN.");
    }

    const userData = await getUserDataFromDb(matchedUserId);
    if (!userData) {
        return;
    }

    let user = classStateStore.getUser(userData.email);
    if (!user) {
        user = createStudentFromUserData(userData, { isGuest: false });
        classStateStore.setUser(userData.email, user);
    }

    req.user = {
        email: userData.email,
        ...user,
        id: user.id || userData.id,
        userId: user.id || userData.id,
    };
}

/**
 * Middleware to check if a user has a specific global scope.
 * Uses the new scope-based permission system with backward-compatible role resolution.
 * @param {string} scope - e.g. 'global.class.create'
 * @returns {Function} Express middleware function.
 */
function hasScope(scope) {
    return async function (req, res, next) {
        const result = await attachDigipogPinUser(req, res);
        if (result instanceof AuthError) {
            throw result;
        }

        if (!req.user || !req.user.email) {
            req.warnEvent("auth.scope_check.not_authenticated", "Scope check failed: User is not authenticated");
            throw new AuthError("User is not authenticated");
        }

        const user = classStateStore.getUser(req.user.email);
        if (!user) {
            req.warnEvent("auth.scope_check.user_not_found", `User not found for scope check: ${req.user.email}`, { email: req.user.email });
            throw new AuthError("User not found", { event: "permission.check.failed", reason: "user_not_found" });
        }

        if (userHasScope(user, scope)) {
            return next();
        }

        req.warnEvent("auth.scope_check.forbidden", `User ${req.user.email} lacks scope ${scope}`, {
            email: req.user.email,
            requiredScope: scope,
        });

        throw new ForbiddenError("You do not have permission to access this resource.", {
            event: "permission.check.failed",
            reason: "insufficient_scope",
            scope,
        });
    };
}

/**
 * Middleware to check if a user has a specific class-scoped permission.
 * Resolves class ID from req.params.id, req.user.classId, or req.user.activeClass.
 * @param {string} scope - e.g. 'class.poll.create'
 * @returns {Function} Express middleware function.
 */
function hasClassScope(scope) {
    return async function (req, res, next) {
        const result = await attachDigipogPinUser(req, res);
        if (result instanceof AuthError) {
            throw result;
        }

        if (!req.user || !req.user.email) {
            req.warnEvent("auth.class_scope_check.not_authenticated", "Class scope check failed: User is not authenticated");
            throw new AuthError("User is not authenticated", { event: "permission.check.failed", reason: "not_authenticated" });
        }

        const classId = normalizeClassId(req.params.id || req.user.classId || req.user.activeClass);
        if (classId === undefined || classId === null || classId === "") {
            throw new ValidationError("Class ID is required.", { event: "permission.check.failed", reason: "class_id_required" });
        }

        const classroom = classStateStore.getClassroom(classId);
        if (!classroom) {
            throw new ForbiddenError("This class is not currently active.", { event: "permission.check.failed", reason: "class_not_active" });
        }

        const email = req.user.email;
        const classUser = classroom.students[email];
        if (!classUser) {
            req.warnEvent("auth.class_scope_check.user_not_in_class", `User ${email} not in class ${classId}`, { email, classId });
            throw new ForbiddenError("User not found in this class.", { event: "permission.check.failed", reason: "user_not_in_class" });
        }

        if (userHasScope(classUser, scope, classroom)) {
            return next();
        }

        req.warnEvent("auth.class_scope_check.forbidden", `User ${email} lacks class scope ${scope} in class ${classId}`, {
            email,
            classId,
            requiredScope: scope,
        });

        throw new ForbiddenError("Insufficient class permissions.", {
            event: "permission.check.failed",
            reason: "insufficient_class_scope",
            scope,
        });
    };
}

/**
 * Middleware: allows access if the user is targeting themselves (req.params.id === req.user.id)
 * or if the user has the specified scope (e.g. manager/admin).
 * @param {string} scope - The scope required if the user is not targeting themselves.
 * @param {string} [message] - Optional custom error message.
 * @returns {Function} Express middleware function.
 */
function isSelfOrHasScope(scope, message) {
    return function (req, res, next) {
        if (!req.user || !req.user.email) {
            throw new AuthError("User is not authenticated");
        }

        const targetId = Number(req.params.id);
        if (req.user.id === targetId) {
            return next();
        }

        const user = classStateStore.getUser(req.user.email) || req.user;
        if (userHasScope(user, scope)) {
            return next();
        }

        req.warnEvent("auth.self_or_scope.forbidden", `User ${req.user.email} is not target and lacks scope ${scope}`, {
            email: req.user.email,
            targetId,
            requiredScope: scope,
        });

        throw new ForbiddenError(message || "You do not have permission to access this resource.", {
            event: "permission.check.failed",
            reason: "not_self_and_insufficient_scope",
            scope,
        });
    };
}

/**
 * Middleware: allows access if the user owns the resource or has the specified scope.
 * The ownerCheck function receives (req) and must return a boolean (or promise of boolean).
 * @param {Function} ownerCheck - Async function (req) => boolean indicating ownership.
 * @param {string} scope - The scope required if the user is not the owner.
 * @param {string} [message] - Optional custom error message.
 * @returns {Function} Express middleware function.
 */
function isOwnerOrHasScope(ownerCheck, scope, message) {
    return async function (req, res, next) {
        if (!req.user || !req.user.email) {
            throw new AuthError("User is not authenticated");
        }

        const isOwner = await ownerCheck(req);
        if (isOwner) {
            return next();
        }

        const user = classStateStore.getUser(req.user.email) || req.user;
        if (userHasScope(user, scope)) {
            return next();
        }

        req.warnEvent("auth.owner_or_scope.forbidden", `User ${req.user.email} is not owner and lacks scope ${scope}`, {
            email: req.user.email,
            requiredScope: scope,
        });

        throw new ForbiddenError(message || "You do not have permission to access this resource.", {
            event: "permission.check.failed",
            reason: "not_owner_and_insufficient_scope",
            scope,
        });
    };
}

/**
 * Middleware: checks if the user is a member of the class (enrolled in classusers or the class owner).
 * Resolves class ID from req.params.id, req.user.classId, or req.user.activeClass.
 * Does NOT require the class to be active in memory — checks the database.
 * @returns {Function} Express middleware function.
 */
function isClassMember() {
    return async function (req, res, next) {
        if (!req.user || !req.user.id) {
            throw new AuthError("User is not authenticated");
        }

        const classId = normalizeClassId(req.params.id || req.user.classId || req.user.activeClass);
        if (classId === undefined || classId === null || classId === "") {
            throw new NotFoundError("Class ID is required.", { event: "permission.check.failed", reason: "class_not_found" });
        }

        // Check in-memory first (fast path)
        const classroom = classStateStore.getClassroom(classId);
        if (classroom && classroom.students[req.user.email]) {
            return next();
        }

        // Fall back to database check
        const membership = await dbGet("SELECT 1 FROM classusers WHERE studentId=? AND classId=?", [req.user.id, classId]);
        if (membership) {
            return next();
        }

        const ownership = await dbGet("SELECT 1 FROM classroom WHERE id=? AND owner=?", [classId, req.user.id]);
        if (ownership) {
            return next();
        }

        throw new ForbiddenError("You are not a member of this class.", {
            event: "permission.check.failed",
            reason: "not_class_member",
        });
    };
}

module.exports = {
    hasScope,
    hasClassScope,
    isSelfOrHasScope,
    isOwnerOrHasScope,
    isClassMember,
    normalizeClassId,
};
