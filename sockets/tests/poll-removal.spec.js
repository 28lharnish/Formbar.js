const { run: pollRemovalRun } = require("../polls/poll-removal");
const { createTestClass, createTestUser, testData, createSocket, createSocketUpdates } = require("@modules/tests/tests");
const { classStateStore } = require("@services/classroom-service");

jest.mock("@modules/database");
jest.mock("@modules/logger", () => ({
    getLogger: jest.fn().mockResolvedValue({ log: jest.fn() }),
    logEvent: jest.fn(),
}));

describe("deletePoll", () => {
    let socket;
    let socketUpdates;
    let deletePollHandler;

    beforeEach(() => {
        socket = createSocket();
        socketUpdates = createSocketUpdates();
        createTestClass(testData.code, "Test Class");
        createTestUser(testData.email, testData.code, 3);

        pollRemovalRun(socket, socketUpdates);
        deletePollHandler = socket.on.mock.calls.find((call) => call[0] === "deletePoll")[1];
    });

    afterEach(() => {
        classStateStore._state = { users: {}, classrooms: {} };
        jest.clearAllMocks();
    });

    it("should emit a message if no pollId is provided", async () => {
        await deletePollHandler(null);
        expect(socket.emit).toHaveBeenCalledWith("message", "No poll is selected.");
    });

    it("should emit a message if the poll is not found", async () => {
        const { dbGet } = require("@modules/database");
        dbGet.mockResolvedValueOnce(null);

        await deletePollHandler(99);
        expect(socket.emit).toHaveBeenCalledWith("message", "Poll not found.");
    });

    it("should emit a message if the user does not own the poll", async () => {
        const { dbGet } = require("@modules/database");
        dbGet.mockResolvedValueOnce({ id: 1, owner: 999, prompt: "Test" });

        await deletePollHandler(1);
        expect(socket.emit).toHaveBeenCalledWith("message", "You do not have permission to delete this poll.");
    });

    it("should delete the poll if the user is the owner", async () => {
        const { dbGet, dbRun } = require("@modules/database");
        dbGet.mockResolvedValueOnce({ id: 1, owner: testData.userId, prompt: "Test" });
        dbRun.mockResolvedValue({});

        const student = classStateStore.getUser(testData.email);
        student.sharedPolls = [1];
        student.ownedPolls = [1];

        await deletePollHandler(1);
        expect(socket.emit).toHaveBeenCalledWith("message", "Poll deleted successfully!");
    });
});
