const { run: pollResponseRun } = require("../polls/poll-response");
const { classStateStore } = require("@services/classroom-service");
const { createSocket, createSocketUpdates, createTestClass, createTestUser, testData } = require("@modules/tests/tests");

describe("pollResp", () => {
    let socket;
    let socketUpdates;
    let pollRespHandler;

    beforeEach(() => {
        socket = createSocket();
        socketUpdates = createSocketUpdates();

        pollResponseRun(socket, socketUpdates);
        pollRespHandler = socket.on.mock.calls.find((call) => call[0] === "pollResp")[1];
    });

    afterEach(() => {
        classStateStore._state = { users: {}, classrooms: {} };
    });

    it("should register a pollResp event", () => {
        const events = socket.on.mock.calls.map((call) => call[0]);
        expect(events).toContain("pollResp");
    });

    it("should do nothing if the class has no active poll", async () => {
        const classData = createTestClass(testData.code, "Test Class");
        createTestUser(testData.email, testData.code, 2);
        classData.poll.status = false;

        await pollRespHandler("a", "");

        const student = classStateStore.getClassroomStudent(testData.classId, testData.email);
        expect(student.pollRes.buttonRes).toBe("");
    });

    it("should record a valid poll response", async () => {
        const classData = createTestClass(testData.code, "Test Class");
        createTestUser(testData.email, testData.code, 2);

        classData.poll = {
            status: true,
            responses: [
                { answer: "a", weight: 1, color: "#ff0000" },
                { answer: "b", weight: 1, color: "#00ff00" },
            ],
            allowTextResponses: false,
            allowMultipleResponses: false,
            allowVoteChanges: true,
            blind: false,
            excludedRespondents: [],
            weight: 1,
        };

        await pollRespHandler("a", "");

        const student = classStateStore.getClassroomStudent(testData.classId, testData.email);
        expect(student.pollRes.buttonRes).toBe("a");
    });

    it("should reject an invalid poll response", async () => {
        const classData = createTestClass(testData.code, "Test Class");
        createTestUser(testData.email, testData.code, 2);

        classData.poll = {
            status: true,
            responses: [{ answer: "a", weight: 1, color: "#ff0000" }],
            allowTextResponses: false,
            allowMultipleResponses: false,
            allowVoteChanges: true,
            blind: false,
            excludedRespondents: [],
            weight: 1,
        };

        await pollRespHandler("z", "");

        const student = classStateStore.getClassroomStudent(testData.classId, testData.email);
        expect(student.pollRes.buttonRes).toBe("");
    });

    it("should not update response when vote changes are disabled and a response already exists", async () => {
        const classData = createTestClass(testData.code, "Test Class");
        const userData = createTestUser(testData.email, testData.code, 2);
        userData.pollRes.buttonRes = "a";

        classData.poll = {
            status: true,
            responses: [
                { answer: "a", weight: 1, color: "#ff0000" },
                { answer: "b", weight: 1, color: "#00ff00" },
            ],
            allowTextResponses: false,
            allowMultipleResponses: false,
            allowVoteChanges: false,
            blind: false,
            excludedRespondents: [],
            weight: 1,
        };

        await pollRespHandler("b", "");

        const student = classStateStore.getClassroomStudent(testData.classId, testData.email);
        expect(student.pollRes.buttonRes).toBe("a");
    });
});
