const request = require("supertest");
const fs = require("fs");
const { createTestDb } = require("@test-helpers/db");
const { createTestApp, clearClassStateStore } = require("./helpers/test-app");

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

const configController = require("../config");
const certsController = require("../certs");

const app = createTestApp(configController, certsController);

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    clearClassStateStore();
    jest.restoreAllMocks();
});

afterAll(async () => {
    await mockDatabase.close();
});

describe("GET /api/v1/config", () => {
    it("returns 200 with emailEnabled and oidcProviders flags", async () => {
        const res = await request(app).get("/api/v1/config");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({
            emailEnabled: false,
            oidcProviders: [],
        });
    });

    it("response data contains only the expected keys", async () => {
        const res = await request(app).get("/api/v1/config");

        expect(res.status).toBe(200);
        expect(Object.keys(res.body.data)).toEqual(expect.arrayContaining(["emailEnabled", "oidcProviders"]));
        expect(Object.keys(res.body.data)).toHaveLength(2);
    });
});

describe("GET /api/v1/certs", () => {
    it("returns 200 with a publicKey string", async () => {
        jest.spyOn(fs, "readFileSync").mockReturnValue("mock-pem-content");

        const res = await request(app).get("/api/v1/certs");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({ publicKey: "mock-pem-content" });
    });

    it("reads the correct PEM file", async () => {
        const spy = jest.spyOn(fs, "readFileSync").mockReturnValue("test-key");

        await request(app).get("/api/v1/certs");

        expect(spy).toHaveBeenCalledWith("public-key.pem", "utf8");
    });

    it("returns 500 when the PEM file cannot be read", async () => {
        // Suppress expected console.error from the error handler
        jest.spyOn(console, "error").mockImplementation(() => {});
        jest.spyOn(console, "log").mockImplementation(() => {});

        // Ensure the logger mock includes close() so the error handler doesn't crash
        const { getLogger } = require("@modules/logger");
        getLogger.mockResolvedValue({
            log: jest.fn(),
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            close: jest.fn(),
        });

        jest.spyOn(fs, "readFileSync").mockImplementation(() => {
            throw new Error("ENOENT: no such file or directory");
        });

        const res = await request(app).get("/api/v1/certs");

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toHaveProperty("message");
    });
});
