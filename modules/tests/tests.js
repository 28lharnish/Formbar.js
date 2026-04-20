/**
 * Shared test helpers for socket unit tests.
 *
 * Provides factory functions for creating mock sockets, mock socketUpdates
 * objects, and populating the in-memory classStateStore with fixture data.
 *
 * Usage:
 *   const { createSocket, createSocketUpdates, createTestClass, createTestUser, testData } =
 *       require('@modules/tests/tests');
 */

const { classStateStore, Classroom } = require("@services/classroom-service");
const { Student } = require("@services/student-service");
const { LEVEL_TO_ROLE } = require("@modules/roles");
const { buildRoleReference } = require("@modules/role-reference");

/** Common test fixture values reused across all socket tests. */
const testData = {
    email: "test@test.com",
    code: "TEST1",
    classId: 1,
    userId: 1,
};

/**
 * Returns a mock socket whose `on` and `emit` calls are recorded by Jest spies.
 * The session is pre-populated with the standard test fixture values.
 * @returns {Object} Mock socket
 */
function createSocket() {
    return {
        on: jest.fn(),
        emit: jest.fn(),
        use: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
        id: "test-socket-id",
        rooms: new Set(["test-socket-id"]),
        handshake: { address: "127.0.0.1" },
        request: {
            session: {
                email: testData.email,
                classId: testData.classId,
                userId: testData.userId,
                displayName: "Test User",
                destroy: jest.fn((cb) => cb && cb()),
                save: jest.fn((cb) => cb && cb()),
            },
            headers: {},
        },
    };
}

/**
 * Returns a mock socketUpdates object where every method is a Jest spy.
 * @returns {Object} Mock socketUpdates
 */
function createSocketUpdates() {
    return {
        classUpdate: jest.fn(),
        customPollUpdate: jest.fn(),
        classBannedUsersUpdate: jest.fn(),
        controlPanelUpdate: jest.fn(),
        pollUpdate: jest.fn(),
        getOwnedClasses: jest.fn(),
        getPollShareIds: jest.fn(),
        timer: jest.fn(),
        invalidateClassPollCache: jest.fn(),
        endClass: jest.fn(),
    };
}

/**
 * Creates a Classroom in the classStateStore using the fixed testData.classId.
 * @param {string} code  - Class access code / key used as `key`.
 * @param {string} name  - Human-readable class name.
 * @returns {Object} The classroom object stored in classStateStore.
 */
function createTestClass(code, name) {
    const classroom = new Classroom({
        id: testData.classId,
        className: name,
        key: code,
        owner: testData.userId,
        permissions: null,
        tags: null,
    });
    classroom.id = testData.classId;
    classStateStore.setClassroom(testData.classId, classroom);
    return classroom;
}

/**
 * Creates a Student in classStateStore (both the global users map and the
 * classroom's students map, if the classroom already exists).
 *
 * @param {string} email       - Student email address.
 * @param {string} code        - Class code (unused but kept for call-site symmetry).
 * @param {number} permissions - Class-level permission value (mapped to role name).
 * @returns {Object} The Student instance added to classStateStore.
 */
function createTestUser(email, code, permissions) {
    const student = new Student(email, testData.userId);
    const roleName = LEVEL_TO_ROLE[permissions] || "Guest";
    const classRole = buildRoleReference({ id: Number(permissions), name: roleName });
    student.roles = { global: [], class: classRole ? [classRole] : [] };
    student.role = roleName;
    student.activeClass = testData.classId;
    classStateStore.setUser(email, student);
    if (classStateStore.getClassroom(testData.classId)) {
        classStateStore.setClassroomStudent(testData.classId, email, student);
    }
    return student;
}

module.exports = {
    testData,
    createSocket,
    createSocketUpdates,
    createTestClass,
    createTestUser,
};
