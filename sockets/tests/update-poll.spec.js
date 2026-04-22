const { run: updatePollRun } = require("../polls/update-poll");
const { classStateStore } = require("@services/classroom-service");
const { createSocket, createSocketUpdates, createTestClass, createTestUser, testData } = require("@modules/tests/tests");

describe("updatePoll", () => {
    let socket;
    let socketUpdates;
    let updatePollHandler;

    beforeEach(() => {
        socket = createSocket();
        socketUpdates = createSocketUpdates();

        updatePollRun(socket, socketUpdates);
        updatePollHandler = socket.on.mock.calls.find((call) => call[0] === "updatePoll")[1];
    });

    afterEach(() => {
        classStateStore._state = { users: {}, classrooms: {} };
    });

    it("should register an updatePoll event", () => {
        const events = socket.on.mock.calls.map((call) => call[0]);
        expect(events).toContain("updatePoll");
    });

    it("should emit a message when the user is not in a class", async () => {
        socket.request.session.classId = null;
        createTestUser(testData.email, testData.code, 4).activeClass = null;

        await updatePollHandler({ status: false });
        expect(socket.emit).toHaveBeenCalledWith("error", {
            message: "Class ID is required.",
            event: "updatePoll",
        });
    });

    it("should emit a message when options is null", async () => {
        const classData = createTestClass(testData.code, "Test Class");
        createTestUser(testData.email, testData.code, 4);
        classData.poll.status = true;

        await updatePollHandler(null);
        expect(socket.emit).toHaveBeenCalledWith("error", {
            message: "Invalid poll update options",
            event: "updatePoll",
        });
    });

    it("should emit a message when options is not an object", async () => {
        const classData = createTestClass(testData.code, "Test Class");
        createTestUser(testData.email, testData.code, 4);
        classData.poll.status = true;

        await updatePollHandler("bad-input");
        expect(socket.emit).toHaveBeenCalledWith("error", {
            message: "Invalid poll update options",
            event: "updatePoll",
        });
    });

    it("should update an existing poll property", async () => {
        const classData = createTestClass(testData.code, "Test Class");
        createTestUser(testData.email, testData.code, 4);
        classData.poll = {
            status: true,
            responses: [{ answer: "a", weight: 1, color: "#ff0000" }],
            blind: false,
            allowVoteChanges: true,
            allowMultipleResponses: false,
            allowTextResponses: false,
            excludedRespondents: [],
            weight: 1,
            prompt: "Test",
        };

        await updatePollHandler({ blind: true });

        expect(classData.poll.blind).toBe(true);
    });

    it("should clear the poll when an empty options object is passed", async () => {
        const classData = createTestClass(testData.code, "Test Class");
        createTestUser(testData.email, testData.code, 4);
        classData.poll = {
            status: false,
            responses: [],
            blind: false,
            allowVoteChanges: false,
            allowMultipleResponses: false,
            allowTextResponses: false,
            excludedRespondents: [],
            weight: 1,
            prompt: "Test",
        };

        await updatePollHandler({});

        expect(classData.poll.prompt).toBe("");
    });
});
