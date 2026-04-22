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

const { getUserInventory, addItemToInventory, removeItemFromInventory } = require("@services/inventory-service");

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
});

afterAll(async () => {
    await mockDatabase.close();
});

const USER_ID = 1;
const ITEM_ID = 10;

describe("getUserInventory()", () => {
    it("returns an empty array when the user has no items", async () => {
        const result = await getUserInventory(USER_ID);
        expect(result).toEqual([]);
    });

    it("returns all items belonging to the user", async () => {
        await addItemToInventory(USER_ID, ITEM_ID, 3);
        await addItemToInventory(USER_ID, 20, 1);
        const result = await getUserInventory(USER_ID);
        expect(result).toHaveLength(2);
    });

    it("does not return items belonging to other users", async () => {
        await addItemToInventory(USER_ID, ITEM_ID, 1);
        await addItemToInventory(2, ITEM_ID, 5); // different user
        const result = await getUserInventory(USER_ID);
        expect(result).toHaveLength(1);
    });

    it("returns rows with item_id and quantity fields", async () => {
        await addItemToInventory(USER_ID, ITEM_ID, 7);
        const result = await getUserInventory(USER_ID);
        expect(result[0]).toHaveProperty("item_id", ITEM_ID);
        expect(result[0]).toHaveProperty("quantity", 7);
    });
});

describe("addItemToInventory()", () => {
    it("inserts a new row when the item does not exist", async () => {
        await addItemToInventory(USER_ID, ITEM_ID, 3);
        const row = await mockDatabase.dbGet("SELECT * FROM inventory WHERE user_id = ? AND item_id = ?", [USER_ID, ITEM_ID]);
        expect(row).toBeDefined();
        expect(row.quantity).toBe(3);
    });

    it("increments the quantity when the item already exists", async () => {
        await addItemToInventory(USER_ID, ITEM_ID, 3);
        await addItemToInventory(USER_ID, ITEM_ID, 2);
        const row = await mockDatabase.dbGet("SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?", [USER_ID, ITEM_ID]);
        expect(row.quantity).toBe(5);
    });

    it("handles adding to multiple different items independently", async () => {
        await addItemToInventory(USER_ID, 10, 1);
        await addItemToInventory(USER_ID, 20, 4);
        const items = await getUserInventory(USER_ID);
        const item10 = items.find((i) => i.item_id === 10);
        const item20 = items.find((i) => i.item_id === 20);
        expect(item10.quantity).toBe(1);
        expect(item20.quantity).toBe(4);
    });
});

describe("removeItemFromInventory()", () => {
    it("decrements the quantity when more than 'quantity' remain", async () => {
        await addItemToInventory(USER_ID, ITEM_ID, 10);
        await removeItemFromInventory(USER_ID, ITEM_ID, 3);
        const row = await mockDatabase.dbGet("SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?", [USER_ID, ITEM_ID]);
        expect(row.quantity).toBe(7);
    });

    it("deletes the row when removing exactly the full quantity", async () => {
        await addItemToInventory(USER_ID, ITEM_ID, 5);
        await removeItemFromInventory(USER_ID, ITEM_ID, 5);
        const row = await mockDatabase.dbGet("SELECT * FROM inventory WHERE user_id = ? AND item_id = ?", [USER_ID, ITEM_ID]);
        expect(row).toBeUndefined();
    });

    it("deletes the row when removing more than the current quantity", async () => {
        await addItemToInventory(USER_ID, ITEM_ID, 2);
        await removeItemFromInventory(USER_ID, ITEM_ID, 10);
        const row = await mockDatabase.dbGet("SELECT * FROM inventory WHERE user_id = ? AND item_id = ?", [USER_ID, ITEM_ID]);
        expect(row).toBeUndefined();
    });

    it("throws NotFoundError when the item does not exist in inventory", async () => {
        await expect(removeItemFromInventory(USER_ID, 999, 1)).rejects.toThrow(/not found/i);
    });

    it("does not affect other users' inventory", async () => {
        await addItemToInventory(USER_ID, ITEM_ID, 5);
        await addItemToInventory(2, ITEM_ID, 5);
        await removeItemFromInventory(USER_ID, ITEM_ID, 5);

        const otherRow = await mockDatabase.dbGet("SELECT quantity FROM inventory WHERE user_id = 2 AND item_id = ?", [ITEM_ID]);
        expect(otherRow.quantity).toBe(5);
    });
});
