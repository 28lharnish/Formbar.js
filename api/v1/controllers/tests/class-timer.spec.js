const request = require("supertest");
const { createTestDb } = require("@test-helpers/db");
const { createTestApp, seedAuthenticatedUser, seedClassMembership, clearClassStateStore } = require("./helpers/test-app");

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

jest.mock("@modules/config", () => {
    const crypto = require("crypto");
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return {
        settings: { emailEnabled: false, oidcProviders: [] },
        publicKey,
        privateKey,
        frontendUrl: "http://localhost:3000",
    };
});

jest.mock("@modules/web-server", () => ({
    io: { to: () => ({ emit: jest.fn() }) },
}));

jest.mock("@services/socket-updates-service", () => ({
    advancedEmitToClass: jest.fn(),
    emitToUser: jest.fn(),
    setClassOfApiSockets: jest.fn(),
    setClassOfUserSockets: jest.fn(),
    userUpdateSocket: jest.fn(),
    invalidateClassPollCache: jest.fn(),
}));

jest.mock("@stores/socket-state-store", () => ({
    socketStateStore: {
        getUserSocketsByEmail: jest.fn().mockReturnValue(null),
    },
}));

jest.mock("@services/class-service", () => ({
    ...jest.requireActual("@services/class-service"),
    getTimer: jest.fn().mockReturnValue({ duration: 60, remaining: 30, active: true }),
    startTimer: jest.fn().mockResolvedValue(undefined),
    pauseTimer: jest.fn().mockResolvedValue(undefined),
    resumeTimer: jest.fn().mockResolvedValue(undefined),
    endTimer: jest.fn().mockResolvedValue(undefined),
    clearTimer: jest.fn().mockResolvedValue(undefined),
}));

const classService = require("@services/class-service");

const createClassController = require("../class/create");
const joinController = require("../class/join");
const timerGetController = require("../class/timer/timer");
const timerStartController = require("../class/timer/start");
const timerPauseController = require("../class/timer/pause");
const timerResumeController = require("../class/timer/resume");
const timerEndController = require("../class/timer/end");
const timerClearController = require("../class/timer/clear");

const app = createTestApp(
    createClassController,
    joinController,
    timerGetController,
    timerStartController,
    timerPauseController,
    timerResumeController,
    timerEndController,
    timerClearController
);

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    clearClassStateStore();
    jest.clearAllMocks();
});

afterAll(async () => {
    await mockDatabase.close();
});

async function setupClassWithTeacher() {
    const { tokens: teacherTokens, user: teacher } = await seedAuthenticatedUser(mockDatabase, {
        email: "teacher@test.com",
        displayName: "Teacher",
        permissions: 4,
    });
    const createRes = await request(app)
        .post("/api/v1/class/create")
        .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
        .send({ name: "Timer Test Class" });
    const classId = createRes.body.data.classId;

    // Teacher must join the class so they appear in classroom.students
    // (required by hasClassScope middleware on POST timer endpoints)
    await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

    return { classId, teacherTokens, teacher };
}

async function setupClassWithStudentAndTeacher() {
    const { classId, teacherTokens, teacher } = await setupClassWithTeacher();
    const { tokens: studentTokens, user: student } = await seedAuthenticatedUser(mockDatabase, {
        email: "student@test.com",
        displayName: "Student1",
        permissions: 2,
    });
    await seedClassMembership(mockDatabase, student.id, classId, 2);
    await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${studentTokens.accessToken}`);
    return { classId, teacherTokens, studentTokens, teacher, student };
}

describe("GET /api/v1/class/:id/timer", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/timer");
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when user is not a class member", async () => {
        const { classId } = await setupClassWithTeacher();
        const { tokens: outsiderTokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "outsider@test.com",
            displayName: "Outsider",
            permissions: 2,
        });

        const res = await request(app).get(`/api/v1/class/${classId}/timer`).set("Authorization", `Bearer ${outsiderTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 with timer data for the class owner", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();

        const res = await request(app).get(`/api/v1/class/${classId}/timer`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("timer");
    });
});

describe("POST /api/v1/class/:id/timer/start", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/timer/start").send({ duration: 60000 });
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when student lacks TIMER.CONTROL scope", async () => {
        const { classId, studentTokens } = await setupClassWithStudentAndTeacher();

        const res = await request(app)
            .post(`/api/v1/class/${classId}/timer/start`)
            .set("Authorization", `Bearer ${studentTokens.accessToken}`)
            .send({ duration: 60000 });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when duration is missing", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();

        const res = await request(app)
            .post(`/api/v1/class/${classId}/timer/start`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when duration is not an integer", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();

        const res = await request(app)
            .post(`/api/v1/class/${classId}/timer/start`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ duration: 5.5 });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when duration is zero or negative", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();

        const res = await request(app)
            .post(`/api/v1/class/${classId}/timer/start`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ duration: -10 });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when sound is not a boolean", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();

        const res = await request(app)
            .post(`/api/v1/class/${classId}/timer/start`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ duration: 60000, sound: "yes" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 and starts timer with valid duration", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();

        const res = await request(app)
            .post(`/api/v1/class/${classId}/timer/start`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ duration: 60000 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(classService.startTimer).toHaveBeenCalled();
    });
});

describe("POST /api/v1/class/:id/timer/pause", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/timer/pause");
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when student lacks TIMER.CONTROL scope", async () => {
        const { classId, studentTokens } = await setupClassWithStudentAndTeacher();

        const res = await request(app).post(`/api/v1/class/${classId}/timer/pause`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when no timer exists", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();
        classService.getTimer.mockReturnValueOnce(null);

        const res = await request(app).post(`/api/v1/class/${classId}/timer/pause`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when timer is not active", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();
        classService.getTimer.mockReturnValueOnce({ duration: 60, remaining: 30, active: false });

        const res = await request(app).post(`/api/v1/class/${classId}/timer/pause`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 and pauses the timer", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();

        const res = await request(app).post(`/api/v1/class/${classId}/timer/pause`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(classService.pauseTimer).toHaveBeenCalledWith(expect.any(Number));
    });
});

describe("POST /api/v1/class/:id/timer/resume", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/timer/resume");
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when student lacks TIMER.CONTROL scope", async () => {
        const { classId, studentTokens } = await setupClassWithStudentAndTeacher();

        const res = await request(app).post(`/api/v1/class/${classId}/timer/resume`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when no timer exists", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();
        classService.getTimer.mockReturnValueOnce(null);

        const res = await request(app).post(`/api/v1/class/${classId}/timer/resume`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when timer is not paused", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();
        // active: true means timer is running, not paused
        classService.getTimer.mockReturnValueOnce({ duration: 60, remaining: 30, active: true });

        const res = await request(app).post(`/api/v1/class/${classId}/timer/resume`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 and resumes the timer", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();
        classService.getTimer.mockReturnValueOnce({ duration: 60, remaining: 30, active: false, pausedAt: Date.now() });

        const res = await request(app).post(`/api/v1/class/${classId}/timer/resume`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(classService.resumeTimer).toHaveBeenCalledWith(expect.any(Number));
    });
});

describe("POST /api/v1/class/:id/timer/end", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/timer/end");
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when student lacks TIMER.CONTROL scope", async () => {
        const { classId, studentTokens } = await setupClassWithStudentAndTeacher();

        const res = await request(app).post(`/api/v1/class/${classId}/timer/end`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when no timer exists", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();
        classService.getTimer.mockReturnValueOnce(null);

        const res = await request(app).post(`/api/v1/class/${classId}/timer/end`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when timer is not active", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();
        classService.getTimer.mockReturnValueOnce({ duration: 60, remaining: 30, active: false });

        const res = await request(app).post(`/api/v1/class/${classId}/timer/end`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 and ends the timer", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();

        const res = await request(app).post(`/api/v1/class/${classId}/timer/end`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(classService.endTimer).toHaveBeenCalledWith(expect.any(Number));
    });
});

describe("POST /api/v1/class/:id/timer/clear", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/timer/clear");
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when student lacks TIMER.CONTROL scope", async () => {
        const { classId, studentTokens } = await setupClassWithStudentAndTeacher();

        const res = await request(app).post(`/api/v1/class/${classId}/timer/clear`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 and clears the timer", async () => {
        const { classId, teacherTokens } = await setupClassWithTeacher();

        const res = await request(app).post(`/api/v1/class/${classId}/timer/clear`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(classService.clearTimer).toHaveBeenCalledWith(expect.any(Number));
    });
});
