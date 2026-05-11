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

const createController = require("@controllers/trades/create");
const listController = require("@controllers/user/trades");
const getController = require("@controllers/trades/get");
const acceptController = require("@controllers/trades/accept");
const rejectController = require("@controllers/trades/reject");
const cancelController = require("@controllers/trades/cancel");

let app;

beforeAll(async () => {
    mockDatabase = await createTestDb();
    app = createTestApp(createController, listController, getController, acceptController, rejectController, cancelController);
});

afterEach(async () => {
    await mockDatabase.reset();
    clearClassStateStore();
});

afterAll(async () => {
    await mockDatabase.close();
});

async function seedItem(id, name = "Item", stackSize = 100) {
    await mockDatabase.dbRun("INSERT INTO item_registry (id, name, description, stack_size) VALUES (?, ?, 'desc', ?)", [id, name, stackSize]);
}

async function seedInventory(userId, itemId, quantity) {
    await mockDatabase.dbRun("INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, ?)", [userId, itemId, quantity]);
}

async function seedPool(id, amount = 0) {
    await mockDatabase.dbRun("INSERT INTO digipog_pools (id, name, description, amount) VALUES (?, 'Pool', 'None', ?)", [id, amount]);
}

async function seedPoolOwner(poolId, userId) {
    await mockDatabase.dbRun("INSERT INTO digipog_pool_users (pool_id, user_id, owner) VALUES (?, ?, 1)", [poolId, userId]);
}

describe("POST /api/v1/trades", () => {
    it("creates a trade and returns tradeId", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        await seedItem(1, "Sword");
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 1, 3);

        const res = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 2 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.tradeId).toBeGreaterThan(0);
    });

    it("returns 400 when toUserId is missing", async () => {
        const { tokens: t1 } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });

        expect(res.status).toBe(400);
    });

    it("returns 400 for a self-trade", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase);
        await seedItem(1);
        await seedInventory(u1.id, 1, 5);

        const res = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u1.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });

        expect(res.status).toBe(400);
    });

    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/trades").send({ toUserId: 2, offered: {}, requested: {} });

        expect(res.status).toBe(401);
    });

    it("recipient receives trade_received notification", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        await seedItem(1);
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 1, 3);

        await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });

        const notif = await mockDatabase.dbGet("SELECT * FROM notifications WHERE user_id = ? AND type = 'trade_received'", [u2.id]);
        expect(notif).toBeTruthy();
    });
});

describe("GET /api/v1/trades", () => {
    it("returns all four buckets with pagination metadata", async () => {
        const { tokens: t1 } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).get("/api/v1/user/1/trades").set("Authorization", `Bearer ${t1.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            inbound: expect.objectContaining({ items: expect.any(Array), total: 0, limit: 20, offset: 0 }),
            outbound: expect.objectContaining({ items: expect.any(Array), total: 0 }),
            completed: expect.objectContaining({ items: expect.any(Array), total: 0 }),
            inactive: expect.objectContaining({ items: expect.any(Array), total: 0 }),
        });
    });

    it("returns inbound trade for the recipient", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { tokens: t2, user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        await seedItem(1);
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 1, 5);

        // u1 creates a trade to u2
        await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });

        // u2 lists trades - should see it as inbound
        const res = await request(app).get(`/api/v1/user/${u2.id}/trades`).set("Authorization", `Bearer ${t2.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.inbound.total).toBe(1);
        expect(res.body.data.outbound.total).toBe(0);
    });

    it("returns outbound trade for the requester", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        await seedItem(1);
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 1, 3);

        await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });

        const res = await request(app).get(`/api/v1/user/${u1.id}/trades`).set("Authorization", `Bearer ${t1.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.outbound.total).toBe(1);
    });

    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/user/1/trades");
        expect(res.status).toBe(401);
    });

    it("accepts limit and offset query params", async () => {
        const { tokens: t1 } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).get("/api/v1/user/1/trades?limit=5&offset=0").set("Authorization", `Bearer ${t1.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.inbound.limit).toBe(5);
        expect(res.body.data.inbound.offset).toBe(0);
    });
});

describe("GET /api/v1/trades/:id", () => {
    it("returns the trade for a participant", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { tokens: t2, user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        await seedItem(1);
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 1, 3);

        const createRes = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });
        const tradeId = createRes.body.data.tradeId;

        const res = await request(app).get(`/api/v1/trades/${tradeId}`).set("Authorization", `Bearer ${t2.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(tradeId);
        expect(res.body.data.status).toBe("pending");
    });

    it("returns 404 for a non-participant", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        const { tokens: t3 } = await seedAuthenticatedUser(mockDatabase, { email: "c@test.com", displayName: "UserC" });
        await seedItem(1);
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 1, 3);

        const createRes = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });
        const tradeId = createRes.body.data.tradeId;

        const res = await request(app).get(`/api/v1/trades/${tradeId}`).set("Authorization", `Bearer ${t3.accessToken}`);

        expect(res.status).toBe(404);
    });

    it("returns 404 for nonexistent trade", async () => {
        const { tokens: t1 } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).get("/api/v1/trades/99999").set("Authorization", `Bearer ${t1.accessToken}`);

        expect(res.status).toBe(404);
    });
});

describe("POST /api/v1/trades/:id/accept", () => {
    it("accepts an item-for-item trade and updates both inventories", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { tokens: t2, user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        await seedItem(1, "Sword");
        await seedItem(2, "Shield");
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 2, 3);

        const createRes = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 2 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 2, quantity: 1 }] },
            });
        const tradeId = createRes.body.data.tradeId;

        const res = await request(app).post(`/api/v1/trades/${tradeId}/accept`).set("Authorization", `Bearer ${t2.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.accepted).toBe(true);

        // Verify inventories on disk
        const u1sword = await mockDatabase.dbGet("SELECT COALESCE(SUM(quantity),0) AS t FROM inventory WHERE user_id=? AND item_id=1", [u1.id]);
        const u1shield = await mockDatabase.dbGet("SELECT COALESCE(SUM(quantity),0) AS t FROM inventory WHERE user_id=? AND item_id=2", [u1.id]);
        const u2sword = await mockDatabase.dbGet("SELECT COALESCE(SUM(quantity),0) AS t FROM inventory WHERE user_id=? AND item_id=1", [u2.id]);
        const u2shield = await mockDatabase.dbGet("SELECT COALESCE(SUM(quantity),0) AS t FROM inventory WHERE user_id=? AND item_id=2", [u2.id]);

        expect(u1sword.t).toBe(3); // 5 - 2
        expect(u1shield.t).toBe(1); // received 1
        expect(u2sword.t).toBe(2); // received 2
        expect(u2shield.t).toBe(2); // 3 - 1
    });

    it("accepts pool-digipogs-for-items trade: verifies pool debit, user credit, dev pool tax, item destination", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { tokens: t2, user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });

        await seedPool(0, 0); // developer pool
        await seedPool(1, 500); // u1's pool
        await seedPoolOwner(1, u1.id);
        await seedItem(1, "Sword");
        await seedInventory(u2.id, 1, 10);

        const offeredDigipogs = 100;

        const createRes = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "pool", poolId: 1 }, digipogs: offeredDigipogs },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 3 }] },
            });
        expect(createRes.status).toBe(200);
        const tradeId = createRes.body.data.tradeId;

        const res = await request(app).post(`/api/v1/trades/${tradeId}/accept`).set("Authorization", `Bearer ${t2.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.accepted).toBe(true);

        const taxedAmount = Math.floor(offeredDigipogs * 0.9) > 1 ? Math.floor(offeredDigipogs * 0.9) : 1;
        const taxAmount = offeredDigipogs - taxedAmount;

        // Pool 1 debited
        const pool1 = await mockDatabase.dbGet("SELECT amount FROM digipog_pools WHERE id=1");
        expect(pool1.amount).toBe(400); // 500 - 100

        // u2 receives taxed digipogs (source is inventory → user balance)
        const u2row = await mockDatabase.dbGet("SELECT digipogs FROM users WHERE id=?", [u2.id]);
        expect(u2row.digipogs).toBe(taxedAmount);

        // Dev pool receives tax
        const devPool = await mockDatabase.dbGet("SELECT amount FROM digipog_pools WHERE id=0");
        expect(devPool.amount).toBe(taxAmount);

        // u1 receives 3 Swords
        const u1swords = await mockDatabase.dbGet("SELECT COALESCE(SUM(quantity),0) AS t FROM inventory WHERE user_id=? AND item_id=1", [u1.id]);
        expect(u1swords.t).toBe(3);
    });

    it("returns 403 when requester tries to accept their own trade", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        await seedItem(1);
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 1, 3);

        const createRes = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });
        const tradeId = createRes.body.data.tradeId;

        const res = await request(app).post(`/api/v1/trades/${tradeId}/accept`).set("Authorization", `Bearer ${t1.accessToken}`); // requester, not recipient

        expect(res.status).toBe(403);
    });

    it("returns accepted=false when inventory is stale and makes no partial movements", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { tokens: t2, user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        await seedItem(1, "Sword");
        await seedItem(2, "Shield");
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 2, 1);

        const createRes = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 5 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 2, quantity: 1 }] },
            });
        const tradeId = createRes.body.data.tradeId;

        // Remove u1's swords to make trade stale
        await mockDatabase.dbRun("DELETE FROM inventory WHERE user_id=? AND item_id=1", [u1.id]);

        const res = await request(app).post(`/api/v1/trades/${tradeId}/accept`).set("Authorization", `Bearer ${t2.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.accepted).toBe(false);

        // u2's inventory must be untouched
        const u2shield = await mockDatabase.dbGet("SELECT COALESCE(SUM(quantity),0) AS t FROM inventory WHERE user_id=? AND item_id=2", [u2.id]);
        expect(u2shield.t).toBe(1);

        // Both participants notified of failure
        const n1 = await mockDatabase.dbGet("SELECT 1 FROM notifications WHERE user_id=? AND type='trade_failed'", [u1.id]);
        const n2 = await mockDatabase.dbGet("SELECT 1 FROM notifications WHERE user_id=? AND type='trade_failed'", [u2.id]);
        expect(n1).toBeTruthy();
        expect(n2).toBeTruthy();
    });

    it("returns 404 for a non-participant", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        const { tokens: t3 } = await seedAuthenticatedUser(mockDatabase, { email: "c@test.com", displayName: "UserC" });
        await seedItem(1);
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 1, 3);

        const createRes = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });
        const tradeId = createRes.body.data.tradeId;

        const res = await request(app).post(`/api/v1/trades/${tradeId}/accept`).set("Authorization", `Bearer ${t3.accessToken}`);

        expect(res.status).toBe(404);
    });
});

describe("POST /api/v1/trades/:id/reject", () => {
    it("rejects a trade as the recipient and notifies requester", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { tokens: t2, user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        await seedItem(1);
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 1, 3);

        const createRes = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });
        const tradeId = createRes.body.data.tradeId;

        const res = await request(app).post(`/api/v1/trades/${tradeId}/reject`).set("Authorization", `Bearer ${t2.accessToken}`);

        expect(res.status).toBe(200);

        const trade = await mockDatabase.dbGet("SELECT status FROM trades WHERE id=?", [tradeId]);
        expect(trade.status).toBe("rejected");

        const notif = await mockDatabase.dbGet("SELECT 1 FROM notifications WHERE user_id=? AND type='trade_rejected'", [u1.id]);
        expect(notif).toBeTruthy();
    });

    it("returns 403 when the requester tries to reject their own trade", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        await seedItem(1);
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 1, 3);

        const createRes = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });
        const tradeId = createRes.body.data.tradeId;

        const res = await request(app).post(`/api/v1/trades/${tradeId}/reject`).set("Authorization", `Bearer ${t1.accessToken}`);

        expect(res.status).toBe(403);
    });

    it("returns 400 when trade is already completed", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { tokens: t2, user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        await seedItem(1);
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 1, 3);

        const createRes = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });
        const tradeId = createRes.body.data.tradeId;

        // Accept it first
        await request(app).post(`/api/v1/trades/${tradeId}/accept`).set("Authorization", `Bearer ${t2.accessToken}`);

        // Now try to reject it
        const res = await request(app).post(`/api/v1/trades/${tradeId}/reject`).set("Authorization", `Bearer ${t2.accessToken}`);

        expect(res.status).toBe(400);
    });
});

describe("POST /api/v1/trades/:id/cancel", () => {
    it("cancels a trade as the requester and notifies recipient", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        await seedItem(1);
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 1, 3);

        const createRes = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });
        const tradeId = createRes.body.data.tradeId;

        const res = await request(app).post(`/api/v1/trades/${tradeId}/cancel`).set("Authorization", `Bearer ${t1.accessToken}`);

        expect(res.status).toBe(200);

        const trade = await mockDatabase.dbGet("SELECT status FROM trades WHERE id=?", [tradeId]);
        expect(trade.status).toBe("canceled");

        const notif = await mockDatabase.dbGet("SELECT 1 FROM notifications WHERE user_id=? AND type='trade_canceled'", [u2.id]);
        expect(notif).toBeTruthy();
    });

    it("returns 403 when the recipient tries to cancel the trade", async () => {
        const { tokens: t1, user: u1 } = await seedAuthenticatedUser(mockDatabase, { email: "a@test.com", displayName: "UserA" });
        const { tokens: t2, user: u2 } = await seedAuthenticatedUser(mockDatabase, { email: "b@test.com", displayName: "UserB" });
        await seedItem(1);
        await seedInventory(u1.id, 1, 5);
        await seedInventory(u2.id, 1, 3);

        const createRes = await request(app)
            .post("/api/v1/trades")
            .set("Authorization", `Bearer ${t1.accessToken}`)
            .send({
                toUserId: u2.id,
                offered: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
                requested: { source: { type: "inventory" }, items: [{ itemId: 1, quantity: 1 }] },
            });
        const tradeId = createRes.body.data.tradeId;

        const res = await request(app).post(`/api/v1/trades/${tradeId}/cancel`).set("Authorization", `Bearer ${t2.accessToken}`); // recipient, not requester

        expect(res.status).toBe(403);
    });
});
