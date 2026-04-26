const request = require("supertest");
const { createTestDb } = require("@test-helpers/db");
const { createTestApp, seedAuthenticatedUser, clearClassStateStore } = require("./helpers/test-app");

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

// Mock log-service to avoid filesystem dependencies
jest.mock("@services/log-service", () => ({
    getAllLogs: jest.fn().mockResolvedValue(["app-2025-01-01.log", "error-2025-01-01.log"]),
    getLog: jest.fn().mockResolvedValue("line1\nline2\nline3"),
}));

const ipController = require("../ip");
const managerController = require("../manager/manager");
const logsController = require("../logs");

const app = createTestApp(ipController, managerController, logsController);

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    clearClassStateStore();
});

afterAll(async () => {
    await mockDatabase.close();
});

async function seedAdmin() {
    return seedAuthenticatedUser(mockDatabase, {
        email: "admin@example.com",
        displayName: "Admin1",
        permissions: 5,
    });
}

async function seedStudent() {
    return seedAuthenticatedUser(mockDatabase, {
        email: "student@example.com",
        displayName: "Student1",
        permissions: 2,
    });
}

describe("GET /api/v1/ip/:type", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/ip/whitelist");
        expect(res.status).toBe(401);
    });

    it("returns 403 for a student (permissions=2)", async () => {
        const { tokens } = await seedStudent();
        const res = await request(app).get("/api/v1/ip/whitelist").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(403);
    });

    it("returns 200 with admin and empty list", async () => {
        const { tokens } = await seedAdmin();
        const res = await request(app).get("/api/v1/ip/whitelist").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.ips).toEqual([]);
        expect(res.body.data.pagination).toEqual({
            total: 0,
            limit: 20,
            offset: 0,
            hasMore: false,
        });
    });

    it("returns paginated IP entries", async () => {
        const { tokens } = await seedAdmin();
        await request(app).post("/api/v1/ip/whitelist").set("Authorization", `Bearer ${tokens.accessToken}`).send({ ip: "10.0.0.1" });
        await request(app).post("/api/v1/ip/whitelist").set("Authorization", `Bearer ${tokens.accessToken}`).send({ ip: "10.0.0.2" });

        const res = await request(app).get("/api/v1/ip/whitelist?limit=1").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.ips).toHaveLength(1);
        expect(res.body.data.pagination).toEqual({
            total: 2,
            limit: 1,
            offset: 0,
            hasMore: true,
        });
    });

    it("returns 400 for invalid type", async () => {
        const { tokens } = await seedAdmin();
        const res = await request(app).get("/api/v1/ip/invalid").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(400);
    });
});

describe("POST /api/v1/ip/:type", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/ip/whitelist").send({ ip: "10.0.0.1" });
        expect(res.status).toBe(401);
    });

    it("returns 403 for a student", async () => {
        const { tokens } = await seedStudent();
        const res = await request(app).post("/api/v1/ip/whitelist").set("Authorization", `Bearer ${tokens.accessToken}`).send({ ip: "10.0.0.1" });
        expect(res.status).toBe(403);
    });

    it("returns 201 when admin adds a valid IP", async () => {
        const { tokens } = await seedAdmin();
        const res = await request(app).post("/api/v1/ip/whitelist").set("Authorization", `Bearer ${tokens.accessToken}`).send({ ip: "192.168.1.1" });
        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.ok).toBe(true);
    });

    it("returns 400 when ip is missing from body", async () => {
        const { tokens } = await seedAdmin();
        const res = await request(app).post("/api/v1/ip/whitelist").set("Authorization", `Bearer ${tokens.accessToken}`).send({});
        expect(res.status).toBe(400);
    });

    it("returns 409 when adding a duplicate IP", async () => {
        const { tokens } = await seedAdmin();
        await request(app).post("/api/v1/ip/blacklist").set("Authorization", `Bearer ${tokens.accessToken}`).send({ ip: "10.0.0.5" });

        const res = await request(app).post("/api/v1/ip/blacklist").set("Authorization", `Bearer ${tokens.accessToken}`).send({ ip: "10.0.0.5" });
        expect(res.status).toBe(409);
    });
});

describe("PUT /api/v1/ip/:type/:id", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).put("/api/v1/ip/whitelist/1").send({ ip: "10.0.0.2" });
        expect(res.status).toBe(401);
    });

    it("returns 403 for a student", async () => {
        const { tokens } = await seedStudent();
        const res = await request(app).put("/api/v1/ip/whitelist/1").set("Authorization", `Bearer ${tokens.accessToken}`).send({ ip: "10.0.0.2" });
        expect(res.status).toBe(403);
    });

    it("returns 200 when admin updates an IP entry", async () => {
        const { tokens } = await seedAdmin();
        // Seed an IP entry first
        await request(app).post("/api/v1/ip/whitelist").set("Authorization", `Bearer ${tokens.accessToken}`).send({ ip: "10.0.0.1" });

        const listRes = await request(app).get("/api/v1/ip/whitelist").set("Authorization", `Bearer ${tokens.accessToken}`);
        const ipEntry = listRes.body.data.ips[0];

        const res = await request(app)
            .put(`/api/v1/ip/whitelist/${ipEntry.id}`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ ip: "10.0.0.99" });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.ok).toBe(true);
    });

    it("returns 400 when ip is missing from body", async () => {
        const { tokens } = await seedAdmin();
        const res = await request(app).put("/api/v1/ip/whitelist/1").set("Authorization", `Bearer ${tokens.accessToken}`).send({});
        expect(res.status).toBe(400);
    });
});

describe("DELETE /api/v1/ip/:type/:id", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).delete("/api/v1/ip/whitelist/1");
        expect(res.status).toBe(401);
    });

    it("returns 403 for a student", async () => {
        const { tokens } = await seedStudent();
        const res = await request(app).delete("/api/v1/ip/whitelist/1").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(403);
    });

    it("returns 200 when admin deletes an IP entry", async () => {
        const { tokens } = await seedAdmin();
        // Seed an IP entry
        await request(app).post("/api/v1/ip/blacklist").set("Authorization", `Bearer ${tokens.accessToken}`).send({ ip: "172.16.0.1" });

        const listRes = await request(app).get("/api/v1/ip/blacklist").set("Authorization", `Bearer ${tokens.accessToken}`);
        const ipEntry = listRes.body.data.ips[0];

        const res = await request(app).delete(`/api/v1/ip/blacklist/${ipEntry.id}`).set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.ok).toBe(true);

        // Verify it was removed
        const listAfter = await request(app).get("/api/v1/ip/blacklist").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(listAfter.body.data.ips).toEqual([]);
    });
});

describe("GET /api/v1/manager", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/manager");
        expect(res.status).toBe(401);
    });

    it("returns 403 for a student", async () => {
        const { tokens } = await seedStudent();
        const res = await request(app).get("/api/v1/manager").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(403);
    });

    it("returns 200 with manager data for admin", async () => {
        const { tokens } = await seedAdmin();
        const res = await request(app).get("/api/v1/manager").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("users");
        expect(res.body.data).toHaveProperty("classrooms");
        expect(res.body.data).toHaveProperty("pagination");
    });
});

describe("GET /api/v1/logs", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/logs");
        expect(res.status).toBe(401);
    });

    it("returns 403 for a student", async () => {
        const { tokens } = await seedStudent();
        const res = await request(app).get("/api/v1/logs").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(403);
    });

    it("returns 200 with log file list for admin", async () => {
        const { tokens } = await seedAdmin();
        const res = await request(app).get("/api/v1/logs?limit=1").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.logs).toEqual(["app-2025-01-01.log"]);
        expect(res.body.data.pagination).toEqual({
            total: 2,
            limit: 1,
            offset: 0,
            hasMore: true,
        });
    });
});

describe("GET /api/v1/logs/:log", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/logs/app-2025-01-01.log");
        expect(res.status).toBe(401);
    });

    it("returns 403 for a student", async () => {
        const { tokens } = await seedStudent();
        const res = await request(app).get("/api/v1/logs/app-2025-01-01.log").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(403);
    });

    it("returns 200 with log content for admin", async () => {
        const { tokens } = await seedAdmin();
        const res = await request(app).get("/api/v1/logs/app-2025-01-01.log").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.text).toBe("line1\nline2\nline3");
    });
});

describe("POST /api/v1/ip/:type/toggle", () => {
    const fs = require("fs");
    const { settings } = require("@modules/config");

    let readSpy, writeSpy;

    beforeEach(() => {
        settings.whitelistActive = false;
        settings.blacklistActive = false;

        readSpy = jest.spyOn(fs, "readFileSync").mockReturnValue("WHITELIST_ENABLED='false'\nBLACKLIST_ENABLED='false'\n");
        writeSpy = jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    });

    afterEach(() => {
        readSpy.mockRestore();
        writeSpy.mockRestore();
    });

    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/ip/whitelist/toggle");
        expect(res.status).toBe(401);
    });

    it("returns 403 for a student", async () => {
        const { tokens } = await seedStudent();
        const res = await request(app).post("/api/v1/ip/whitelist/toggle").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(403);
    });

    it("returns 200 and toggles whitelist active for admin", async () => {
        const { tokens } = await seedAdmin();
        const res = await request(app).post("/api/v1/ip/whitelist/toggle").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.ok).toBe(true);
        expect(res.body.data.active).toBe(true);
        expect(res.body.data.otherDisabled).toBe(true);
        expect(writeSpy).toHaveBeenCalled();
    });

    it("returns 400 for invalid type", async () => {
        const { tokens } = await seedAdmin();
        const res = await request(app).post("/api/v1/ip/invalidtype/toggle").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(400);
    });
});
