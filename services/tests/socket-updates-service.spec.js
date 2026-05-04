const mockClassrooms = {};

jest.mock("@modules/database", () => ({
    database: {
        all: jest.fn(),
        get: jest.fn(),
    },
    dbGetAll: jest.fn(),
}));

jest.mock("@modules/web-server", () => ({
    io: {
        in: jest.fn(() => ({
            fetchSockets: jest.fn(async () => []),
        })),
        to: jest.fn(() => ({
            emit: jest.fn(),
        })),
    },
}));

jest.mock("@services/classroom-service", () => ({
    classStateStore: {
        getClassroom: jest.fn((classId) => mockClassrooms[classId] || null),
        getUser: jest.fn(),
    },
}));

jest.mock("@services/manager-service", () => ({
    getManagerData: jest.fn(async () => ({ users: [], classrooms: [] })),
}));

jest.mock("@stores/socket-state-store", () => ({
    socketStateStore: {
        getRunningTimers: jest.fn(() => ({})),
        getRateLimits: jest.fn(() => ({})),
        getUserSockets: jest.fn(() => ({})),
        getUserSocketsByEmail: jest.fn(() => null),
        hasUserSockets: jest.fn(() => false),
    },
}));

const { SCOPES } = require("@modules/permissions");
const { SocketUpdates } = require("@services/socket-updates-service");

function makeSocket(email = "student@example.com") {
    return {
        emit: jest.fn(),
        request: {
            session: {
                email,
                classId: 1,
            },
        },
    };
}

function makeClassroom() {
    return {
        id: 1,
        className: "Demo Class",
        isActive: true,
        owner: 99,
        key: "ABC123",
        settings: { emailEnabled: false },
        timer: { active: true, sound: false },
        availableRoles: [{ id: 7, name: "Reader", scopes: [SCOPES.CLASS.ROLES.READ] }],
        poll: {
            status: true,
            prompt: "Question?",
            responses: [{ answer: "A", color: "#fff" }],
            allowTextResponses: false,
            allowMultipleResponses: false,
            blind: false,
            weight: 1,
            excludedRespondents: [],
        },
        students: {
            "teacher@example.com": {
                id: 10,
                email: "teacher@example.com",
                displayName: "Teacher",
                activeClass: 1,
                roles: { global: [], class: ["teacher-role"] },
                scopes: {
                    global: [],
                    class: [
                        SCOPES.CLASS.SYSTEM.PANEL_ACCESS,
                        SCOPES.CLASS.POLL.CREATE,
                        SCOPES.CLASS.STUDENTS.KICK,
                        SCOPES.CLASS.SESSION.SETTINGS,
                        SCOPES.CLASS.STUDENTS.READ,
                        SCOPES.CLASS.POLL.READ,
                        SCOPES.CLASS.ROLES.READ,
                        SCOPES.CLASS.TIMER.READ,
                        SCOPES.CLASS.SESSION.REGENERATE_CODE,
                    ],
                },
                pollRes: { buttonRes: "A", textRes: "", date: null },
                help: false,
                break: false,
                pogMeter: 0,
                isGuest: false,
            },
            "student@example.com": {
                id: 11,
                email: "student@example.com",
                displayName: "Student",
                activeClass: 1,
                roles: { global: [], class: [] },
                scopes: {
                    global: [],
                    class: [SCOPES.CLASS.POLL.READ],
                },
                pollRes: { buttonRes: "A", textRes: "", date: null },
                help: true,
                break: false,
                pogMeter: 2,
                isGuest: false,
            },
            "reader@example.com": {
                id: 12,
                email: "reader@example.com",
                displayName: "Reader",
                activeClass: 1,
                roles: { global: [], class: [] },
                scopes: {
                    global: [],
                    class: [
                        SCOPES.CLASS.STUDENTS.READ,
                        SCOPES.CLASS.POLL.READ,
                        SCOPES.CLASS.ROLES.READ,
                        SCOPES.CLASS.SESSION.SETTINGS,
                        SCOPES.CLASS.TIMER.READ,
                        SCOPES.CLASS.SESSION.REGENERATE_CODE,
                    ],
                },
                pollRes: { buttonRes: "A", textRes: "", date: null },
                help: false,
                break: false,
                pogMeter: 1,
                isGuest: false,
            },
        },
    };
}

describe("SocketUpdates classUpdate visibility", () => {
    beforeEach(() => {
        mockClassrooms[1] = makeClassroom();
    });

    afterEach(() => {
        delete mockClassrooms[1];
        jest.clearAllMocks();
    });

    it("limits the payload to the viewer when they do not have students.read", () => {
        const socket = makeSocket();
        const updates = new SocketUpdates(socket);

        updates.classUpdate(1, { global: false });

        expect(socket.emit).toHaveBeenCalledWith(
            "classUpdate",
            expect.objectContaining({
                key: undefined,
                settings: undefined,
                roles: undefined,
                students: expect.objectContaining({
                    11: expect.objectContaining({
                        id: 11,
                        displayName: "Student",
                    }),
                }),
                poll: expect.objectContaining({
                    totalResponses: 1,
                    totalResponders: 1,
                }),
            })
        );
        const payload = socket.emit.mock.calls[0][1];
        expect(payload.students[10]).toBeUndefined();
    });

    it("includes broader class data when the viewer has the matching scopes", () => {
        const socket = makeSocket("reader@example.com");
        const updates = new SocketUpdates(socket);

        updates.classUpdate(1, { global: false });

        const payload = socket.emit.mock.calls[0][1];
        expect(payload.key).toBe("ABC123");
        expect(payload.settings).toEqual({ emailEnabled: false });
        expect(payload.roles).toEqual(expect.arrayContaining([expect.objectContaining({ id: 7 })]));
        expect(payload.students[10]).toBeDefined();
        expect(payload.students[11]).toBeDefined();
        expect(payload.students[12]).toBeDefined();
        expect(payload.poll).toEqual(
            expect.objectContaining({
                status: true,
                prompt: "Question?",
                totalResponses: expect.any(Number),
                totalResponders: expect.any(Number),
            })
        );
    });
});
