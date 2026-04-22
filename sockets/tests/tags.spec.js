const { run: tagsRun } = require("../tags");
const { classStateStore } = require("@services/classroom-service");
const { createSocket, createSocketUpdates, createTestClass, createTestUser, testData } = require("@modules/tests/tests");

describe("tags", () => {
    let socket;
    let socketUpdates;
    let setTagsHandler;
    let saveTagsHandler;

    beforeEach(() => {
        socket = createSocket();
        socketUpdates = createSocketUpdates();
        createTestClass(testData.code, "Test Class");
        createTestUser(testData.email, testData.code, 3);

        tagsRun(socket, socketUpdates);
        setTagsHandler = socket.on.mock.calls.find((call) => call[0] === "setTags")[1];
        saveTagsHandler = socket.on.mock.calls.find((call) => call[0] === "saveTags")[1];
    });

    afterEach(() => {
        classStateStore._state = { users: {}, classrooms: {} };
        jest.clearAllMocks();
    });

    it("should register setTags and saveTags events", () => {
        const events = socket.on.mock.calls.map((call) => call[0]);
        expect(events).toContain("setTags");
        expect(events).toContain("saveTags");
    });

    describe("setTags event", () => {
        it("should update the class tags and call socketUpdates.classUpdate", async () => {
            const classData = classStateStore.getClassroom(testData.classId);
            classData.tags = ["Offline"];

            await setTagsHandler(["tag1", "tag2"]);

            expect(classData.tags).toContain("tag1");
            expect(classData.tags).toContain("tag2");
            expect(classData.tags).toContain("Offline");
            expect(socketUpdates.classUpdate).toHaveBeenCalled();
        });

        it("should ignore non-string tag entries", async () => {
            const classData = classStateStore.getClassroom(testData.classId);

            await setTagsHandler(["validTag", 123, null, "anotherTag"]);

            expect(classData.tags).toContain("validTag");
            expect(classData.tags).toContain("anotherTag");
        });

        it("should not emit a server error message when non-array is passed", async () => {
            // setTags returns early (no throw) for non-array input,
            // so the socket handler should not emit a 'message' error.
            await setTagsHandler("not-an-array");
            expect(socket.emit).not.toHaveBeenCalledWith("message", "There was a server error try again.");
        });
    });

    describe("saveTags event", () => {
        it("should update the student tags in the class and call socketUpdates.classUpdate", async () => {
            const classData = classStateStore.getClassroom(testData.classId);
            classData.tags = ["tag1", "tag2", "Offline"];
            const userData = classStateStore.getUser(testData.email);

            await saveTagsHandler(userData.id, ["tag1"]);

            const student = classStateStore.getClassroomStudent(testData.classId, testData.email);
            expect(student.tags).toContain("tag1");
            expect(socketUpdates.classUpdate).toHaveBeenCalled();
        });

        it("should clear response if student gains the Excluded tag", async () => {
            const classData = classStateStore.getClassroom(testData.classId);
            classData.tags = ["Excluded", "Offline"];
            const userData = classStateStore.getUser(testData.email);
            userData.pollRes = { buttonRes: "a", textRes: "", date: null };
            userData.tags = [];

            await saveTagsHandler(userData.id, ["Excluded"]);

            const student = classStateStore.getClassroomStudent(testData.classId, testData.email);
            expect(student.pollRes.buttonRes).toBe("");
        });
    });
});
