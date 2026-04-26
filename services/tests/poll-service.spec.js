const { createTestDb } = require("@test-helpers/db");

let mockDatabase;

jest.mock("@modules/database", () => {
    const dbProxy = new Proxy(
        {},
        {
            get(_, method) {
                return (...args) => mockDatabase.db[method](...args);
            },
        }
    );
    return {
        get database() {
            return dbProxy;
        },
        dbGet: (...args) => mockDatabase.dbGet(...args),
        dbRun: (...args) => mockDatabase.dbRun(...args),
        dbGetAll: (...args) => mockDatabase.dbGetAll(...args),
    };
});

jest.mock("@modules/config", () => ({
    settings: { emailEnabled: false },
    frontendUrl: "http://localhost:3000",
    rateLimit: { maxAttempts: 5, lockoutDuration: 900000, minDelayBetweenAttempts: 1000, attemptWindow: 300000 },
}));

const mockClassrooms = {};
jest.mock("@services/classroom-service", () => ({
    classStateStore: {
        getClassroom: jest.fn((id) => mockClassrooms[id] || null),
        getUser: jest.fn(),
    },
}));

jest.mock("@services/socket-updates-service", () => ({
    advancedEmitToClass: jest.fn(),
    userUpdateSocket: jest.fn(),
}));

jest.mock("../../sockets/init", () => ({
    userSocketUpdates: new Map(),
}));

jest.mock("@stores/poll-runtime-store", () => ({
    pollRuntimeStore: {
        resetPogMeterTracker: jest.fn(),
        hasPogMeterIncreased: jest.fn(() => false),
        markPogMeterIncreased: jest.fn(),
        clearPogMeterTracker: jest.fn(),
        clearLastSavedPollId: jest.fn(),
        clearPollStartTime: jest.fn(),
        getLastSavedPollId: jest.fn(() => null),
        setLastSavedPollId: jest.fn(),
        setPollStartTime: jest.fn(),
    },
}));

const { getPollResponses, deleteCustomPolls, getPreviousPolls, getCurrentPoll } = require("@services/poll-service");
const { classStateStore } = require("@services/classroom-service");
const NotFoundError = require("@errors/not-found-error");
const ForbiddenError = require("@errors/forbidden-error");

async function migratePollHistoryTable(db) {
    await new Promise((resolve, reject) => {
        db.exec(
            `
            DROP TABLE IF EXISTS poll_history;
            CREATE TABLE poll_history (
                "id"                       INTEGER NOT NULL UNIQUE,
                "class"                    INTEGER NOT NULL,
                "prompt"                   TEXT,
                "responses"                TEXT,
                "allowMultipleResponses"   INTEGER NOT NULL DEFAULT 0,
                "blind"                    INTEGER NOT NULL DEFAULT 0,
                "allowTextResponses"       INTEGER NOT NULL DEFAULT 0,
                "createdAt"                INTEGER NOT NULL,
                PRIMARY KEY ("id" AUTOINCREMENT)
            );
            `,
            (err) => (err ? reject(err) : resolve())
        );
    });
}

beforeAll(async () => {
    mockDatabase = await createTestDb();
    await migratePollHistoryTable(mockDatabase.db);
});

afterEach(async () => {
    await mockDatabase.reset();
    await migratePollHistoryTable(mockDatabase.db);
    await mockDatabase.dbRun("DELETE FROM custom_polls WHERE id > 4");
    Object.keys(mockClassrooms).forEach((k) => delete mockClassrooms[k]);
    jest.clearAllMocks();
});

afterAll(async () => {
    await mockDatabase.close();
});

function makeClassData({ pollStatus = true, responses = [], students = {} } = {}) {
    return {
        poll: { status: pollStatus, responses },
        students,
    };
}

function makeStudent(buttonRes = "", textRes = "") {
    return { pollRes: { buttonRes, textRes } };
}

describe("getPollResponses", () => {
    it("returns empty object when poll.status is false", () => {
        const result = getPollResponses(makeClassData({ pollStatus: false }));
        expect(result).toEqual({});
    });

    it("returns empty object when poll.responses is empty", () => {
        const result = getPollResponses(makeClassData({ pollStatus: true, responses: [] }));
        expect(result).toEqual({});
    });

    it("counts a single student response", () => {
        const result = getPollResponses(
            makeClassData({
                responses: [
                    { answer: "A", weight: 1, color: "#FF0000" },
                    { answer: "B", weight: 1, color: "#0000FF" },
                ],
                students: { "s1@test.com": makeStudent("A") },
            })
        );

        expect(result["A"].responses).toBe(1);
        expect(result["B"].responses).toBe(0);
    });

    it("students who have not responded do not affect counts", () => {
        const result = getPollResponses(
            makeClassData({
                responses: [{ answer: "Yes", weight: 1, color: "#00FF00" }],
                students: {
                    "s1@test.com": makeStudent(""),
                    "s2@test.com": makeStudent(""),
                },
            })
        );

        expect(result["Yes"].responses).toBe(0);
    });

    it("increments count for multiple students with the same response", () => {
        const result = getPollResponses(
            makeClassData({
                responses: [
                    { answer: "X", weight: 1, color: "#111" },
                    { answer: "Y", weight: 1, color: "#222" },
                ],
                students: {
                    "a@test.com": makeStudent("X"),
                    "b@test.com": makeStudent("X"),
                    "c@test.com": makeStudent("Y"),
                },
            })
        );

        expect(result["X"].responses).toBe(2);
        expect(result["Y"].responses).toBe(1);
    });

    it("preserves weight and color in the output", () => {
        const result = getPollResponses(
            makeClassData({
                responses: [{ answer: "Up", weight: 0.9, color: "#00FF00" }],
                students: {},
            })
        );

        expect(result["Up"]).toEqual({
            answer: "Up",
            weight: 0.9,
            color: "#00FF00",
            responses: 0,
        });
    });

    it("ignores students whose response does not match any answer", () => {
        const result = getPollResponses(
            makeClassData({
                responses: [{ answer: "A", weight: 1, color: "#F00" }],
                students: {
                    "s1@test.com": makeStudent("Z"),
                    "s2@test.com": makeStudent("A"),
                },
            })
        );

        expect(result["A"].responses).toBe(1);
    });

    it("handles many responses and many students", () => {
        const responses = [
            { answer: "A", weight: 1, color: "#1" },
            { answer: "B", weight: 2, color: "#2" },
            { answer: "C", weight: 3, color: "#3" },
        ];
        const students = {};
        for (let i = 0; i < 10; i++) {
            students[`s${i}@test.com`] = makeStudent(responses[i % 3].answer);
        }

        const result = getPollResponses(makeClassData({ responses, students }));

        expect(result["A"].responses).toBe(4);
        expect(result["B"].responses).toBe(3);
        expect(result["C"].responses).toBe(3);
    });

    it("preserves extra properties on response objects", () => {
        const result = getPollResponses(
            makeClassData({
                responses: [{ answer: "Yes", weight: 1, color: "#0F0", correct: true }],
                students: {},
            })
        );

        expect(result["Yes"].correct).toBe(true);
    });
});

describe("deleteCustomPolls", () => {
    async function seedCustomPoll(owner, name = "Test Poll") {
        return mockDatabase.dbRun(
            `INSERT INTO custom_polls (owner, name, prompt, answers, textRes, blind, allowVoteChanges, allowMultipleResponses, weight, public)
             VALUES (?, ?, 'prompt', '[]', 0, 0, 1, 0, 1, 0)`,
            [owner, name]
        );
    }

    async function seedSharedPoll(pollId, userId) {
        return mockDatabase.dbRun("INSERT INTO shared_polls (pollId, userId) VALUES (?, ?)", [pollId, userId]);
    }

    it("deletes custom polls owned by the user", async () => {
        const pollId = await seedCustomPoll(42);

        await deleteCustomPolls(42);

        const remaining = await mockDatabase.dbGetAll("SELECT * FROM custom_polls WHERE owner = ?", [42]);
        expect(remaining).toHaveLength(0);
    });

    it("deletes shared_polls entries for the deleted polls", async () => {
        const pollId = await seedCustomPoll(42);
        await seedSharedPoll(pollId, 99);
        await seedSharedPoll(pollId, 100);

        await deleteCustomPolls(42);

        const sharedRemaining = await mockDatabase.dbGetAll("SELECT * FROM shared_polls WHERE pollId = ?", [pollId]);
        expect(sharedRemaining).toHaveLength(0);
    });

    it("does nothing when user has no custom polls", async () => {
        await seedCustomPoll(99);

        await deleteCustomPolls(42);

        const polls = await mockDatabase.dbGetAll("SELECT * FROM custom_polls WHERE owner = ?", [99]);
        expect(polls).toHaveLength(1);
    });

    it("only deletes polls for the specified user", async () => {
        await seedCustomPoll(42, "Mine");
        await seedCustomPoll(99, "Theirs");

        await deleteCustomPolls(42);

        const mine = await mockDatabase.dbGetAll("SELECT * FROM custom_polls WHERE owner = ?", [42]);
        const theirs = await mockDatabase.dbGetAll("SELECT * FROM custom_polls WHERE owner = ?", [99]);
        expect(mine).toHaveLength(0);
        expect(theirs).toHaveLength(1);
    });

    it("handles multiple polls with shared entries", async () => {
        const p1 = await seedCustomPoll(42, "Poll 1");
        const p2 = await seedCustomPoll(42, "Poll 2");
        await seedSharedPoll(p1, 10);
        await seedSharedPoll(p2, 20);
        await seedSharedPoll(p2, 30);

        await deleteCustomPolls(42);

        const shared = await mockDatabase.dbGetAll("SELECT * FROM shared_polls WHERE pollId IN (?, ?)", [p1, p2]);
        expect(shared).toHaveLength(0);
    });
});

describe("getPreviousPolls", () => {
    async function seedPollHistory(classId, prompt, responses, opts = {}) {
        const { allowMultipleResponses = 0, blind = 0, allowTextResponses = 0, createdAt = Date.now() } = opts;
        return mockDatabase.dbRun(
            `INSERT INTO poll_history (class, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [classId, prompt, JSON.stringify(responses), allowMultipleResponses, blind, allowTextResponses, createdAt]
        );
    }

    it("returns poll history entries for a class", async () => {
        await seedPollHistory(1, "Thumbs?", [{ answer: "Up" }, { answer: "Down" }]);

        const { polls, total } = await getPreviousPolls(1);

        expect(polls).toHaveLength(1);
        expect(total).toBe(1);
        expect(polls[0].classPollId).toBe(1);
        expect(polls[0].globalPollId).toEqual(expect.any(Number));
        expect(polls[0].prompt).toBe("Thumbs?");
        expect(polls[0]).not.toHaveProperty("id");
        expect(polls[0]).not.toHaveProperty("class");
    });

    it("returns empty array when no history exists", async () => {
        const result = await getPreviousPolls(999);
        expect(result).toEqual({ polls: [], total: 0 });
    });

    it("parses responses JSON string into an object", async () => {
        const responses = [
            { answer: "A", weight: 1 },
            { answer: "B", weight: 2 },
        ];
        await seedPollHistory(1, "Pick one", responses);

        const { polls } = await getPreviousPolls(1);

        expect(polls[0].responses).toEqual(responses);
    });

    it("sets responses to empty array when JSON is invalid", async () => {
        await mockDatabase.dbRun(
            `INSERT INTO poll_history (class, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [1, "Bad", "{not-json", 0, 0, 0, Date.now()]
        );

        const { polls } = await getPreviousPolls(1);

        expect(polls[0].responses).toEqual([]);
    });

    it("converts integer booleans to actual booleans", async () => {
        await seedPollHistory(1, "Q", [], { allowMultipleResponses: 1, blind: 1, allowTextResponses: 1 });

        const { polls } = await getPreviousPolls(1);

        expect(polls[0].allowMultipleResponses).toBe(true);
        expect(polls[0].blind).toBe(true);
        expect(polls[0].allowTextResponses).toBe(true);
    });

    it("converts zero booleans to false", async () => {
        await seedPollHistory(1, "Q", [], { allowMultipleResponses: 0, blind: 0, allowTextResponses: 0 });

        const { polls } = await getPreviousPolls(1);

        expect(polls[0].allowMultipleResponses).toBe(false);
        expect(polls[0].blind).toBe(false);
        expect(polls[0].allowTextResponses).toBe(false);
    });

    it("returns results ordered by id descending (newest first)", async () => {
        await seedPollHistory(1, "First", []);
        await seedPollHistory(1, "Second", []);
        await seedPollHistory(1, "Third", []);

        const { polls, total } = await getPreviousPolls(1);

        expect(polls[0].prompt).toBe("Third");
        expect(polls[0].classPollId).toBe(3);
        expect(polls[1].prompt).toBe("Second");
        expect(polls[1].classPollId).toBe(2);
        expect(polls[2].prompt).toBe("First");
        expect(polls[2].classPollId).toBe(1);
        expect(total).toBe(3);
    });

    it("respects pagination with limit and offset", async () => {
        for (let i = 0; i < 5; i++) {
            await seedPollHistory(1, `Poll ${i}`, []);
        }

        const page = await getPreviousPolls(1, 2, 1);

        expect(page.polls).toHaveLength(2);
        expect(page.total).toBe(5);
        expect(page.polls[0].prompt).toBe("Poll 3");
        expect(page.polls[1].prompt).toBe("Poll 2");
    });

    it("only returns polls for the requested class", async () => {
        await seedPollHistory(1, "Class 1 poll", []);
        await seedPollHistory(2, "Class 2 poll", []);

        const { polls, total } = await getPreviousPolls(1);

        expect(polls).toHaveLength(1);
        expect(polls[0].prompt).toBe("Class 1 poll");
        expect(total).toBe(1);
    });

    it("leaves responses untouched when already a non-string type", async () => {
        await mockDatabase.dbRun(
            `INSERT INTO poll_history (class, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [1, "Q", null, 0, 0, 0, Date.now()]
        );

        const { polls } = await getPreviousPolls(1);
        expect(polls[0].responses).toEqual([]);
    });
});

describe("getCurrentPoll", () => {
    const userData = { email: "student@test.com", id: 10 };

    function setupClassroom(id, pollData = {}, students = {}) {
        mockClassrooms[id] = {
            poll: {
                status: false,
                prompt: "",
                responses: [],
                allowTextResponses: false,
                allowMultipleResponses: false,
                blind: false,
                weight: 1,
                excludedRespondents: [],
                ...pollData,
            },
            students,
        };
    }

    it("returns poll data when classroom exists and user is a student", async () => {
        setupClassroom(1, { status: true, prompt: "Thumbs?", responses: [{ answer: "Up" }] }, { "student@test.com": makeStudent() });

        const result = await getCurrentPoll(1, userData);

        expect(result.status).toBe(true);
        expect(result.prompt).toBe("Thumbs?");
    });

    it("includes totalStudents count", async () => {
        setupClassroom(
            1,
            { status: true },
            {
                "s1@test.com": makeStudent(),
                "s2@test.com": makeStudent(),
                "s3@test.com": makeStudent(),
                "student@test.com": makeStudent(),
            }
        );

        const result = await getCurrentPoll(1, userData);

        expect(result.totalStudents).toBe(4);
    });

    it("throws NotFoundError when classroom is not in memory and not in DB", async () => {
        await expect(getCurrentPoll(999, userData)).rejects.toThrow(NotFoundError);
        await expect(getCurrentPoll(999, userData)).rejects.toThrow("This class does not exist");
    });

    it("throws NotFoundError with 'not currently active' when class exists in DB but not in memory", async () => {
        await mockDatabase.dbRun("INSERT INTO classroom (id, name, owner, key) VALUES (?, ?, ?, ?)", [5, "Test", 1, 1234]);

        await expect(getCurrentPoll(5, userData)).rejects.toThrow("This class is not currently active");
    });

    it("throws ForbiddenError when user is not a student in the class", async () => {
        setupClassroom(1, { status: true }, { "other@test.com": makeStudent() });

        await expect(getCurrentPoll(1, userData)).rejects.toThrow(ForbiddenError);
    });

    it("returns a deep clone of the poll (not a reference)", async () => {
        setupClassroom(1, { status: true, prompt: "Q", responses: [{ answer: "A" }] }, { "student@test.com": makeStudent() });

        const result = await getCurrentPoll(1, userData);
        result.prompt = "MODIFIED";

        expect(mockClassrooms[1].poll.prompt).toBe("Q");
    });

    it("includes poll.status in the returned object", async () => {
        setupClassroom(1, { status: false }, { "student@test.com": makeStudent() });

        const result = await getCurrentPoll(1, userData);

        expect(result.status).toBe(false);
    });
});
