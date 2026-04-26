/**
 * Shared test helpers for HTTP endpoint testing with supertest.
 *
 * Provides a factory for creating lightweight Express apps that register
 * individual controller modules, along with helpers for seeding
 * authenticated users and cleaning up in-memory state between tests.
 */

require("express-async-errors");
const express = require("express");
const { setGlobalPermissionLevel, addClassMemberWithPermission } = require("@test-helpers/role-seeding");

/**
 * Creates a lightweight Express app for HTTP endpoint testing.
 * Registers the provided controller modules on a router mounted at /api/v1.
 *
 * @param {...Function} controllerModules - Controller functions that accept (router)
 * @returns {import('express').Express}
 */
function createTestApp(...controllerModules) {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Stub request logger functions (needed by controllers and error handler)
    app.use((req, res, next) => {
        req.infoEvent = jest.fn();
        req.warnEvent = jest.fn();
        req.errorEvent = jest.fn();
        req.logEvent = jest.fn();
        next();
    });

    const router = express.Router();
    for (const registerRoute of controllerModules) {
        if (typeof registerRoute === "function") {
            registerRoute(router);
        }
    }
    app.use("/api/v1", router);

    // Error handler (same one the real app uses)
    const errorHandler = require("@middleware/error-handler");
    app.use(errorHandler);

    return app;
}

/**
 * Seeds a user in the test database and adds them to classStateStore
 * so that isAuthenticated middleware works for subsequent requests.
 *
 * @param {object} mockDatabase - The test database created by createTestDb()
 * @param {object} [overrides] - Optional overrides for email, password, displayName, permissions
 * @returns {{ tokens: { accessToken: string, refreshToken: string }, user: object }}
 */
async function seedAuthenticatedUser(mockDatabase, overrides = {}) {
    const { register } = require("@services/auth-service");
    const { classStateStore } = require("@services/classroom-service");
    const { createStudentFromUserData } = require("@services/student-service");

    const email = overrides.email || "test@example.com";
    const password = overrides.password || "TestPass1!";
    const displayName = overrides.displayName || "TestUser";

    const result = await register(email, password, displayName);

    if (overrides.permissions !== undefined) {
        await setGlobalPermissionLevel(mockDatabase, result.user.id, overrides.permissions);
    }

    const userData = await require("@services/user-service").getUserDataFromDb(result.user.id);
    const student = createStudentFromUserData(userData, { isGuest: false });
    classStateStore.setUser(email, student);

    return {
        tokens: result.tokens,
        user: { ...userData, id: result.user.id },
    };
}

/**
 * Seed Class Membership.
 *
 * @param {*} mockDatabase - mockDatabase.
 * @param {*} userId - userId.
 * @param {*} classId - classId.
 * @param {*} permissionLevel - permissionLevel.
 * @param {*} options - options.
 * @returns {Promise<*>}
 */
async function seedClassMembership(mockDatabase, userId, classId, permissionLevel, options = {}) {
    return addClassMemberWithPermission(mockDatabase, userId, classId, permissionLevel, options);
}

/**
 * Clears all users and classrooms from classStateStore.
 * Call this in afterEach to prevent state leaking between tests.
 */
function clearClassStateStore() {
    const { classStateStore } = require("@services/classroom-service");
    const state = classStateStore.getRawState();
    for (const key of Object.keys(state.users)) {
        delete state.users[key];
    }
    for (const key of Object.keys(state.classrooms)) {
        delete state.classrooms[key];
    }
}

module.exports = { createTestApp, seedAuthenticatedUser, seedClassMembership, clearClassStateStore };
