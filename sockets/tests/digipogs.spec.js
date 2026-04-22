jest.mock("@services/digipog-service");

const { run: digipogsRun } = require("../digipogs");
const { awardDigipogs, transferDigipogs } = require("@services/digipog-service");
const { SCOPES } = require("@modules/permissions");
const { classStateStore } = require("@services/classroom-service");
const { createSocket, createTestClass, createTestUser, testData } = require("@modules/tests/tests");

describe("digipogs", () => {
    let socket;
    let awardDigipogsHandler;
    let transferDigipogsHandler;

    beforeEach(() => {
        socket = createSocket();
        createTestClass(testData.code, "Test Class");
        createTestUser(testData.email, testData.code, 4);
        digipogsRun(socket);
        awardDigipogsHandler = socket.on.mock.calls.find((call) => call[0] === "awardDigipogs")[1];
        transferDigipogsHandler = socket.on.mock.calls.find((call) => call[0] === "transferDigipogs")[1];
    });

    afterEach(() => {
        classStateStore._state = { users: {}, classrooms: {} };
        jest.clearAllMocks();
    });

    it("should register awardDigipogs and transferDigipogs events", () => {
        const events = socket.on.mock.calls.map((call) => call[0]);
        expect(events).toContain("awardDigipogs");
        expect(events).toContain("transferDigipogs");
    });

    it("should emit awardDigipogsResponse with the service result", async () => {
        awardDigipogs.mockResolvedValueOnce({ success: true, amount: 10 });
        const awardData = { userId: 2, amount: 10 };

        await awardDigipogsHandler(awardData);

        expect(awardDigipogs).toHaveBeenCalledWith(awardData, socket.request.session);
        expect(socket.emit).toHaveBeenCalledWith("awardDigipogsResponse", { success: true, amount: 10 });
    });

    it("should emit transferResponse with the service result", async () => {
        transferDigipogs.mockResolvedValueOnce({ success: true });
        const transferData = { fromId: 1, toId: 2, amount: 5 };
        classStateStore.getUser(testData.email).scopes = { global: [SCOPES.GLOBAL.DIGIPOGS.TRANSFER], class: [] };

        await transferDigipogsHandler(transferData);

        expect(transferDigipogs).toHaveBeenCalledWith(transferData);
        expect(socket.emit).toHaveBeenCalledWith("transferResponse", { success: true });
    });

    it("should emit awardDigipogsResponse even when service returns an error result", async () => {
        awardDigipogs.mockResolvedValueOnce({ success: false, message: "Insufficient permissions" });

        await awardDigipogsHandler({ userId: 2, amount: 10 });

        expect(socket.emit).toHaveBeenCalledWith("awardDigipogsResponse", {
            success: false,
            message: "Insufficient permissions",
        });
    });
});
