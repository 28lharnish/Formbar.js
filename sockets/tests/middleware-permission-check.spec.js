jest.mock("@modules/database", () => ({
    dbGet: jest.fn(),
}));

jest.mock("@services/classroom-service", () => ({
    classStateStore: {
        getUser: jest.fn(),
        getClassroom: jest.fn(),
    },
}));

jest.mock("@services/user-service", () => ({
    getUserDataFromDb: jest.fn(),
}));

jest.mock("@modules/socket-error-handler", () => ({
    handleSocketError: jest.fn(),
}));

const { dbGet } = require("@modules/database");
const { classStateStore } = require("@services/classroom-service");
const { getUserDataFromDb } = require("@services/user-service");
const { handleSocketError } = require("@modules/socket-error-handler");
const { SCOPES } = require("@modules/permissions");
const { onSocketEvent, hasScope, hasClassScope } = require("@modules/socket-event-middleware");

describe("socket event middleware", () => {
    let socket;

    beforeEach(() => {
        socket = {
            on: jest.fn(),
            emit: jest.fn(),
            _socketUpdates: {},
            request: {
                session: {
                    email: "teacher@test.com",
                    userId: 42,
                    classId: null,
                    save: jest.fn((cb) => cb && cb()),
                },
            },
        };

        classStateStore.getUser.mockReturnValue(null);
        classStateStore.getClassroom.mockReturnValue(null);
        getUserDataFromDb.mockResolvedValue(null);
        dbGet.mockResolvedValue(null);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("allows an authenticated user with a global scope", async () => {
        classStateStore.getUser.mockReturnValue({
            id: 42,
            email: "teacher@test.com",
            scopes: { global: [SCOPES.GLOBAL.CLASS.DELETE], class: [] },
        });
        const handler = jest.fn();

        onSocketEvent(socket, "deleteClass", hasScope(SCOPES.GLOBAL.CLASS.DELETE), handler);

        await socket.on.mock.calls[0][1](123);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][1]).toBe(123);
        expect(handleSocketError).not.toHaveBeenCalled();
    });

    it("loads the user from the database when the class store is cold", async () => {
        getUserDataFromDb.mockResolvedValue({
            id: 42,
            email: "teacher@test.com",
            activeClass: 7,
            scopes: { global: [], class: [SCOPES.CLASS.SESSION.START] },
        });
        classStateStore.getClassroom.mockReturnValue({
            id: 7,
            owner: 99,
            students: {
                "teacher@test.com": {
                    id: 42,
                    email: "teacher@test.com",
                    scopes: { global: [], class: [SCOPES.CLASS.SESSION.START] },
                },
            },
        });
        const handler = jest.fn();

        onSocketEvent(socket, "startClass", hasClassScope(SCOPES.CLASS.SESSION.START), handler);

        await socket.on.mock.calls[0][1]();

        expect(getUserDataFromDb).toHaveBeenCalledWith(42);
        expect(socket.request.session.classId).toBe(7);
        expect(socket.request.session.save).toHaveBeenCalled();
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("allows a class-scoped event for a classroom member", async () => {
        classStateStore.getUser.mockReturnValue({
            id: 42,
            email: "teacher@test.com",
            activeClass: 7,
            scopes: { global: [], class: [] },
        });
        classStateStore.getClassroom.mockReturnValue({
            id: 7,
            owner: 99,
            students: {
                "teacher@test.com": {
                    id: 42,
                    email: "teacher@test.com",
                    scopes: { global: [], class: [SCOPES.CLASS.SESSION.START] },
                },
            },
        });
        const handler = jest.fn();

        onSocketEvent(socket, "startClass", hasClassScope(SCOPES.CLASS.SESSION.START), handler);

        await socket.on.mock.calls[0][1]();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handleSocketError).not.toHaveBeenCalled();
    });

    it("allows class owner bypass when the owner is not in classroom.students", async () => {
        classStateStore.getUser.mockReturnValue({
            id: 42,
            email: "teacher@test.com",
            activeClass: 7,
            scopes: { global: [], class: [] },
        });
        classStateStore.getClassroom.mockReturnValue({
            id: 7,
            owner: 42,
            students: {},
        });
        const handler = jest.fn();

        onSocketEvent(socket, "startClass", hasClassScope(SCOPES.CLASS.SESSION.START), handler);

        await socket.on.mock.calls[0][1]();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handleSocketError).not.toHaveBeenCalled();
    });

    it("routes missing class id errors through the shared socket error handler", async () => {
        classStateStore.getUser.mockReturnValue({
            id: 42,
            email: "teacher@test.com",
            activeClass: null,
            scopes: { global: [], class: [SCOPES.CLASS.SESSION.START] },
        });

        onSocketEvent(socket, "startClass", hasClassScope(SCOPES.CLASS.SESSION.START), jest.fn());

        await socket.on.mock.calls[0][1]();

        expect(handleSocketError).toHaveBeenCalledTimes(1);
        expect(handleSocketError.mock.calls[0][2]).toBe("startClass");
        expect(handleSocketError.mock.calls[0][3]).toBe("Class ID is required.");
    });

    it("routes insufficient global scope errors through the shared socket error handler", async () => {
        classStateStore.getUser.mockReturnValue({
            id: 42,
            email: "teacher@test.com",
            scopes: { global: [], class: [] },
        });

        onSocketEvent(socket, "deleteClass", hasScope(SCOPES.GLOBAL.CLASS.DELETE), jest.fn());

        await socket.on.mock.calls[0][1](123);

        expect(handleSocketError).toHaveBeenCalledTimes(1);
        expect(handleSocketError.mock.calls[0][2]).toBe("deleteClass");
        expect(handleSocketError.mock.calls[0][3]).toBe("You do not have permission to access this resource.");
    });
});
