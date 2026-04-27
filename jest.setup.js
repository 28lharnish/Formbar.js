// Prevent the tests from using the logger as it can cause tests to fail
jest.mock("./modules/logger.js", () => {
    const logger = {
        log: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        close: jest.fn(),
    };
    logger.child = jest.fn(() => logger);

    return {
        logger,
        getLogger: jest.fn().mockResolvedValue(logger),
        logEvent: jest.fn(),
    };
});

// Prevent tests from using the actual database
jest.mock("./modules/database", () => ({
    database: {
        get: jest.fn(),
        run: jest.fn(),
        all: jest.fn(),
    },
    dbGet: jest.fn().mockResolvedValue({}),
    dbRun: jest.fn().mockResolvedValue({}),
    dbGetAll: jest.fn().mockResolvedValue({}),
}));

// Mock manager service
jest.mock("./services/manager-service", () => ({
    getManagerData: jest.fn().mockResolvedValue({ users: {}, classrooms: {} }),
    getManagerDataPaginated: jest.fn().mockResolvedValue({
        users: [],
        totalUsers: 0,
        classrooms: [],
        pendingUsers: [],
    }),
}));

// Mock web server
jest.mock("./modules/web-server", () => ({
    io: {
        in: jest.fn().mockReturnValue({
            fetchSockets: jest.fn().mockResolvedValue([]),
        }),
        to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    },
}));
