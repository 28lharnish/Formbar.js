jest.mock("@modules/database", () => ({
    dbGet: jest.fn(),
}));

jest.mock("@services/classroom-service", () => ({
    classStateStore: {
        getUser: jest.fn(),
        getClassroom: jest.fn(),
    },
}));

jest.mock("@services/socket-updates-service", () => ({
    PASSIVE_SOCKETS: [],
}));

jest.mock("@services/user-service", () => ({
    getUserDataFromDb: jest.fn(),
}));

jest.mock("@modules/util", () => ({
    camelCaseToNormal: jest.fn((value) => value),
}));

jest.mock("@modules/socket-error-handler", () => ({
    handleSocketError: jest.fn(),
}));

const permissionCheckMiddleware = require("../middleware/permission-check");
const { classStateStore } = require("@services/classroom-service");
const { getUserDataFromDb } = require("@services/user-service");

describe("socket permission-check middleware", () => {
    let socket;
    let middleware;

    beforeEach(() => {
        socket = {
            use: jest.fn(),
            emit: jest.fn(),
            request: {
                session: {
                    email: "teacher@test.com",
                    userId: 42,
                    classId: null,
                    save: jest.fn(),
                },
            },
        };

        classStateStore.getUser.mockReturnValue(null);
        classStateStore.getClassroom.mockReturnValue(null);
        getUserDataFromDb.mockResolvedValue({
            id: 42,
            email: "teacher@test.com",
            roles: {
                global: [
                    {
                        id: 1,
                        name: "Teacher",
                        scopes: JSON.stringify(["global.class.delete"]),
                    },
                ],
                class: [],
            },
        });

        permissionCheckMiddleware.run(socket, {});
        middleware = socket.use.mock.calls[0][0];
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("loads computed user roles from the database when the class store is cold", async () => {
        const next = jest.fn();

        await middleware(["deleteClass"], next);

        expect(getUserDataFromDb).toHaveBeenCalledWith(42);
        expect(next).toHaveBeenCalledTimes(1);
        expect(socket.emit).not.toHaveBeenCalled();
    });
});
