const { run: pollCreationRun } = require("../polls/poll-creation");
const { classStateStore } = require("@services/classroom-service");
const { createPoll } = require("@services/poll-service");
const { handleSocketError } = require("@modules/socket-error-handler");
const { createTestUser, createTestClass, testData, createSocket, createSocketUpdates } = require("@modules/tests/tests");
jest.mock("@services/poll-service");
jest.mock("@modules/socket-error-handler", () => ({
    handleSocketError: jest.fn(),
}));

describe("startPoll", () => {
    let socket;
    let socketUpdates;
    let startPollHandler;

    beforeEach(() => {
        socket = createSocket();
        socketUpdates = createSocketUpdates();

        const classData = createTestClass(testData.code, "Test Class");
        createTestUser(testData.email, testData.code, 5);
        classData.isActive = true;

        classData.students[testData.email].activeClass = classData.id;

        pollCreationRun(socket, socketUpdates);
        startPollHandler = socket.on.mock.calls.find((call) => call[0] === "startPoll")[1];
    });

    it("should start a poll successfully", async () => {
        const pollData = {
            prompt: "Test Poll",
            answers: [{}, {}, {}],
            blind: false,
            weight: 1,
            tags: ["tag1"],
            excludedRespondents: ["box1"],
            indeterminate: ["indeterminate1"],
            allowTextResponses: true,
            allowMultipleResponses: true,
        };

        await startPollHandler(pollData);

        expect(createPoll).toHaveBeenCalledWith(
            testData.classId,
            {
                ...pollData,
                allowVoteChanges: false,
            },
            socket.request.session
        );
        expect(socket.emit).toHaveBeenCalledWith("startPoll");
    });

    it("should pass the normalized poll payload to createPoll", async () => {
        await startPollHandler(false, true, "Prompt", [{ answer: "A" }], true, 2, ["tag1"], [7], ["ghost"], null, true, false);

        expect(createPoll).toHaveBeenCalledWith(
            testData.classId,
            {
                prompt: "Prompt",
                answers: [{ answer: "A" }],
                blind: true,
                allowVoteChanges: false,
                weight: 2,
                tags: ["tag1"],
                excludedRespondents: [7],
                indeterminate: ["ghost"],
                allowTextResponses: true,
                allowMultipleResponses: true,
            },
            socket.request.session
        );
    });

    it("should route poll creation errors through handleSocketError", async () => {
        createPoll.mockRejectedValueOnce(new Error("Test Error"));

        await startPollHandler({
            prompt: "Test Poll",
            answers: [{}, {}, {}],
            blind: false,
            weight: 1,
            tags: ["tag1"],
            excludedRespondents: ["box1"],
            indeterminate: ["indeterminate1"],
            allowTextResponses: true,
            allowMultipleResponses: true,
        });

        expect(handleSocketError).toHaveBeenCalledWith(expect.any(Error), socket, "startPoll");
        expect(socket.emit).not.toHaveBeenCalledWith("startPoll");
    });

    afterEach(() => {
        classStateStore._state = { users: {}, classrooms: {} };
        jest.clearAllMocks();
    });
});
