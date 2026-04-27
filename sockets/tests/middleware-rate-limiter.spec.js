jest.mock("@modules/database", () => ({
    dbGet: jest.fn(),
}));

jest.mock("@services/classroom-service", () => ({
    classStateStore: {
        getUser: jest.fn(),
    },
}));

jest.mock("@services/socket-updates-service", () => ({
    PASSIVE_SOCKETS: [],
}));

jest.mock("@services/user-service", () => ({
    getUserDataFromDb: jest.fn(),
}));

jest.mock("@modules/socket-error-handler", () => ({
    handleSocketError: jest.fn(),
}));

const rateLimitsByIdentifier = {};

jest.mock("@stores/socket-state-store", () => ({
    socketStateStore: {
        getUserRateLimits: jest.fn((identifier) => {
            if (!rateLimitsByIdentifier[identifier]) {
                rateLimitsByIdentifier[identifier] = {};
            }
            return rateLimitsByIdentifier[identifier];
        }),
    },
}));

const rateLimiterMiddleware = require("../middleware/rate-limiter");
const { classStateStore } = require("@services/classroom-service");
const { getUserDataFromDb } = require("@services/user-service");

describe("socket rate-limiter middleware", () => {
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
                },
            },
        };

        classStateStore.getUser.mockReturnValue(null);
        getUserDataFromDb.mockResolvedValue({
            id: 42,
            email: "teacher@test.com",
            roles: {
                global: [
                    {
                        id: 1,
                        name: "Teacher",
                        scopes: JSON.stringify(["global.class.create"]),
                    },
                ],
                class: [],
            },
        });

        rateLimiterMiddleware.run(socket, {});
        middleware = socket.use.mock.calls[0][0];
    });

    afterEach(() => {
        jest.clearAllMocks();
        for (const key of Object.keys(rateLimitsByIdentifier)) {
            delete rateLimitsByIdentifier[key];
        }
    });

    it("applies the elevated teacher socket limit when only DB-backed role data is available", async () => {
        const next = jest.fn();

        for (let i = 0; i < 31; i++) {
            await middleware(["savePoll"], next);
        }

        expect(getUserDataFromDb).toHaveBeenCalledWith(42);
        expect(next).toHaveBeenCalledTimes(31);
        expect(socket.emit).not.toHaveBeenCalled();
        expect(rateLimitsByIdentifier).toHaveProperty("42");
        expect(rateLimitsByIdentifier).not.toHaveProperty("teacher@test.com");
    });
});
