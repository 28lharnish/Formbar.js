const request = require("supertest");
const { createTestDb } = require("@test-helpers/db");
const { createTestApp, seedAuthenticatedUser, clearClassStateStore } = require("./helpers/test-app");
const { registerItem, addItemToInventory } = require("@services/inventory-service");

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

const itemController = require("../item");
const inventoryController = require("../user/inventory");

const app = createTestApp(itemController, inventoryController);

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

async function seedManager() {
    return seedAuthenticatedUser(mockDatabase, {
        email: "manager@example.com",
        displayName: "Manager",
        permissions: 5,
    });
}

async function seedStudent(overrides = {}) {
    return seedAuthenticatedUser(mockDatabase, {
        permissions: 2,
        ...overrides,
    });
}

async function seedTestItem(overrides = {}) {
    const id = await registerItem({
        name: "Health Potion",
        description: "Restores health",
        stackSize: 99,
        iconUrl: "https://example.com/potion.png",
        ...overrides,
    });
    return id;
}

describe("GET /api/v1/item/:id", () => {
    it("returns 200 with item data for a valid item id", async () => {
        const { tokens } = await seedStudent();
        const itemId = await seedTestItem();

        const res = await request(app).get(`/api/v1/item/${itemId}`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toMatchObject({
            id: itemId,
            name: "Health Potion",
            description: "Restores health",
            stack_size: 99,
        });
    });

    it("returns 400 for a non-integer item id", async () => {
        const { tokens } = await seedStudent();

        const res = await request(app).get("/api/v1/item/not-a-number").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 404 when item does not exist", async () => {
        const { tokens } = await seedStudent();

        const res = await request(app).get("/api/v1/item/99999").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 without authentication", async () => {
        const itemId = await seedTestItem();

        const res = await request(app).get(`/api/v1/item/${itemId}`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

describe("GET /api/v1/user/:id/inventory/", () => {
    it("returns 200 with inventory for the owner", async () => {
        const { tokens, user } = await seedStudent();
        const itemId = await seedTestItem();
        await addItemToInventory(user.id, itemId, 3);

        const res = await request(app).get(`/api/v1/user/${user.id}/inventory/`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: itemId,
                    quantity: 3,
                }),
            ])
        );
    });

    it("returns 200 when a manager requests another user's inventory", async () => {
        const { tokens: managerTokens } = await seedManager();
        const { user: target } = await seedStudent({ email: "target@example.com", displayName: "Target User" });
        const itemId = await seedTestItem({ name: "Mana Potion" });
        await addItemToInventory(target.id, itemId, 2);

        const res = await request(app).get(`/api/v1/user/${target.id}/inventory/`).set("Authorization", `Bearer ${managerTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: itemId,
                    quantity: 2,
                }),
            ])
        );
    });

    it("returns 403 when a non-manager requests another user's inventory", async () => {
        const { tokens } = await seedStudent();
        const { user: target } = await seedStudent({ email: "other@example.com", displayName: "Other User" });

        const res = await request(app).get(`/api/v1/user/${target.id}/inventory/`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 without authentication", async () => {
        const { user } = await seedStudent();

        const res = await request(app).get(`/api/v1/user/${user.id}/inventory/`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

describe("DELETE /api/v1/user/:id/inventory/:itemId", () => {
    it("returns 200 and removes quantity for the owner", async () => {
        const { tokens, user } = await seedStudent();
        const itemId = await seedTestItem();
        await addItemToInventory(user.id, itemId, 5);

        const res = await request(app)
            .delete(`/api/v1/user/${user.id}/inventory/${itemId}`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ quantity: 2 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const rows = await mockDatabase.dbGetAll("SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?", [user.id, itemId]);
        expect(rows).toHaveLength(1);
        expect(rows[0].quantity).toBe(3);
    });

    it("returns 200 when a manager removes from another user's inventory", async () => {
        const { tokens: managerTokens } = await seedManager();
        const { user: target } = await seedStudent({ email: "student-target@example.com", displayName: "Target Student" });
        const itemId = await seedTestItem({ name: "Elixir" });
        await addItemToInventory(target.id, itemId, 4);

        const res = await request(app)
            .delete(`/api/v1/user/${target.id}/inventory/${itemId}`)
            .set("Authorization", `Bearer ${managerTokens.accessToken}`)
            .send({ quantity: 1 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const rows = await mockDatabase.dbGetAll("SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?", [target.id, itemId]);
        expect(rows).toHaveLength(1);
        expect(rows[0].quantity).toBe(3);
    });

    it("returns 400 for an invalid user id", async () => {
        const { tokens } = await seedManager();
        const itemId = await seedTestItem();

        const res = await request(app)
            .delete(`/api/v1/user/not-a-user/inventory/${itemId}`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ quantity: 1 });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 for an invalid item id", async () => {
        const { tokens, user } = await seedStudent();

        const res = await request(app)
            .delete(`/api/v1/user/${user.id}/inventory/not-an-item`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ quantity: 1 });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 for non-positive quantity", async () => {
        const { tokens, user } = await seedStudent();
        const itemId = await seedTestItem();

        const res = await request(app)
            .delete(`/api/v1/user/${user.id}/inventory/${itemId}`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ quantity: 0 });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when a non-manager targets another user", async () => {
        const { tokens } = await seedStudent();
        const { user: target } = await seedStudent({ email: "third@example.com", displayName: "Third User" });
        const itemId = await seedTestItem();

        const res = await request(app)
            .delete(`/api/v1/user/${target.id}/inventory/${itemId}`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ quantity: 1 });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 without authentication", async () => {
        const { user } = await seedStudent();
        const itemId = await seedTestItem();

        const res = await request(app).delete(`/api/v1/user/${user.id}/inventory/${itemId}`).send({ quantity: 1 });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});
