jest.mock("@services/auth-service");
jest.mock("@modules/crypto");
jest.mock("@modules/database");
jest.mock("@services/api-key-service");

const { run: backwardsCompatRun } = require("../backwards-compat");
const { verifyToken } = require("@services/auth-service");
const { dbGet } = require("@modules/database");
const { resolveAPIKey } = require("@services/api-key-service");
const { classStateStore } = require("@services/classroom-service");
const { createSocket, createSocketUpdates, testData } = require("@modules/tests/tests");

describe("backwards-compat", () => {
    let socket;
    let socketUpdates;

    beforeEach(() => {
        socket = createSocket();
        socketUpdates = createSocketUpdates();
        backwardsCompatRun(socket, socketUpdates);
    });

    afterEach(() => {
        classStateStore._state = { users: {}, classrooms: {} };
        jest.clearAllMocks();
    });

    it("should register getActiveClass, auth, and getClassroom events", () => {
        const events = socket.on.mock.calls.map((call) => call[0]);
        expect(events).toContain("getActiveClass");
        expect(events).toContain("auth");
        expect(events).toContain("getClassroom");
    });

    describe("getActiveClass event", () => {
        let getActiveClassHandler;

        beforeEach(() => {
            getActiveClassHandler = socket.on.mock.calls.find((call) => call[0] === "getActiveClass")[1];
        });

        it("should echo back the classId when session is already authenticated", async () => {
            // socket already has email set in session
            await getActiveClassHandler("someApiKey");
            expect(socket.emit).toHaveBeenCalledWith("setClass", testData.classId);
        });

        it("should emit an error for an invalid API key format", async () => {
            socket.request.session.email = null;

            await getActiveClassHandler(null);
            expect(socket.emit).toHaveBeenCalledWith("error", "Invalid API key format.");
        });

        it("should emit an error when no user matches the API key", async () => {
            socket.request.session.email = null;
            resolveAPIKey.mockResolvedValueOnce(null);

            await getActiveClassHandler("invalidKey");
            expect(socket.emit).toHaveBeenCalledWith("error", "Invalid API key.");
        });
    });

    describe("auth event", () => {
        let authHandler;

        beforeEach(() => {
            authHandler = socket.on.mock.calls.find((call) => call[0] === "auth")[1];
        });

        it("should echo back the classId when session is already authenticated", async () => {
            await authHandler({ token: "someToken" });
            expect(socket.emit).toHaveBeenCalledWith("setClass", testData.classId);
        });

        it("should emit an error when the token is missing", async () => {
            socket.request.session.email = null;

            await authHandler({});
            expect(socket.emit).toHaveBeenCalledWith("error", "Missing or invalid authentication token.");
        });

        it("should emit an error when the token is invalid", async () => {
            socket.request.session.email = null;
            verifyToken.mockReturnValueOnce({ error: "invalid token" });

            await authHandler({ token: "bad-token" });
            expect(socket.emit).toHaveBeenCalledWith("error", "Invalid access token.");
        });

        it("should emit an error when the user is not found in the database", async () => {
            socket.request.session.email = null;
            verifyToken.mockReturnValueOnce({ email: testData.email, id: testData.userId });
            dbGet.mockResolvedValueOnce(null);

            await authHandler({ token: "valid-token" });
            expect(socket.emit).toHaveBeenCalledWith("error", "User not found.");
        });
    });

    describe("getClassroom event", () => {
        it("should call socketUpdates.classUpdate with the session classId", () => {
            const getClassroomHandler = socket.on.mock.calls.find((call) => call[0] === "getClassroom")[1];
            getClassroomHandler();
            expect(socketUpdates.classUpdate).toHaveBeenCalledWith(testData.classId, { global: false });
        });
    });
});
