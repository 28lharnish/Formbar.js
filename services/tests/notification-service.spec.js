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

const {
    createNotification,
    getNotificationsForUser,
    getNotificationsForUserPaginated,
    getNotificationById,
    markNotificationAsRead,
    deleteNotification,
    emptyInboxForUser,
} = require("@services/notification-service");

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
});

afterAll(async () => {
    await mockDatabase.close();
});

async function seedNotification(userId = 1, type = "test", data = { msg: "hello" }) {
    await createNotification(userId, type, data);
    const [row] = await mockDatabase.dbGetAll("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1", [userId]);
    return row;
}

describe("createNotification()", () => {
    it("inserts a row into the notifications table", async () => {
        await createNotification(1, "info", { text: "hello" });
        const rows = await mockDatabase.dbGetAll("SELECT * FROM notifications");
        expect(rows).toHaveLength(1);
    });

    it("serialises the data field as JSON", async () => {
        const payload = { key: "value", num: 42 };
        await createNotification(1, "info", payload);
        const row = await mockDatabase.dbGet("SELECT * FROM notifications WHERE user_id = 1");
        expect(JSON.parse(row.data)).toEqual(payload);
    });

    it("stores the correct user_id and type", async () => {
        await createNotification(99, "alert", {});
        const row = await mockDatabase.dbGet("SELECT * FROM notifications WHERE user_id = 99");
        expect(row.user_id).toBe(99);
        expect(row.type).toBe("alert");
    });

    it("defaults is_read to 0 (unread)", async () => {
        await createNotification(1, "info", {});
        const row = await mockDatabase.dbGet("SELECT * FROM notifications WHERE user_id = 1");
        expect(row.is_read).toBe(0);
    });
});

describe("getNotificationsForUser()", () => {
    it("returns all notifications for the given user", async () => {
        await createNotification(1, "a", {});
        await createNotification(1, "b", {});
        await createNotification(2, "c", {}); // different user – should NOT appear
        const result = await getNotificationsForUser(1);
        expect(result).toHaveLength(2);
        expect(result.every((n) => n.user_id === 1)).toBe(true);
    });

    it("returns an empty array when the user has no notifications", async () => {
        const result = await getNotificationsForUser(999);
        expect(result).toEqual([]);
    });
});

describe("getNotificationsForUserPaginated()", () => {
    it("returns notifications ordered by newest first with a total count", async () => {
        await createNotification(1, "a", {});
        await createNotification(1, "b", {});
        await createNotification(1, "c", {});

        const result = await getNotificationsForUserPaginated(1, 2, 1);

        expect(result.total).toBe(3);
        expect(result.notifications).toHaveLength(2);
        expect(result.notifications[0].type).toBe("b");
        expect(result.notifications[1].type).toBe("a");
    });

    it("returns an empty page for a user with no notifications", async () => {
        const result = await getNotificationsForUserPaginated(999);
        expect(result).toEqual({ notifications: [], total: 0 });
    });
});

describe("getNotificationById()", () => {
    it("returns the notification with the given id", async () => {
        const seeded = await seedNotification(1, "ping");
        const result = await getNotificationById(seeded.id);
        expect(result).toBeDefined();
        expect(result.id).toBe(seeded.id);
        expect(result.type).toBe("ping");
    });

    it("returns undefined for a non-existent id", async () => {
        const result = await getNotificationById(99999);
        expect(result).toBeUndefined();
    });
});

describe("markNotificationAsRead()", () => {
    it("sets is_read to 1 for the specified notification", async () => {
        const seeded = await seedNotification(1);
        expect(seeded.is_read).toBe(0);

        await markNotificationAsRead(seeded.id);

        const updated = await getNotificationById(seeded.id);
        expect(updated.is_read).toBe(1);
    });

    it("does not affect other notifications", async () => {
        const n1 = await seedNotification(1, "first");
        const n2 = await seedNotification(1, "second");

        await markNotificationAsRead(n1.id);

        const n2Updated = await getNotificationById(n2.id);
        expect(n2Updated.is_read).toBe(0);
    });
});

describe("deleteNotification()", () => {
    it("removes the notification from the database", async () => {
        const seeded = await seedNotification(1);
        await deleteNotification(seeded.id);
        const result = await getNotificationById(seeded.id);
        expect(result).toBeUndefined();
    });

    it("does not remove other notifications", async () => {
        const n1 = await seedNotification(1, "keep");
        const n2 = await seedNotification(1, "delete");
        await deleteNotification(n2.id);

        const all = await getNotificationsForUser(1);
        expect(all).toHaveLength(1);
        expect(all[0].id).toBe(n1.id);
    });
});

describe("emptyInboxForUser()", () => {
    it("deletes all notifications for the given user", async () => {
        await createNotification(1, "a", {});
        await createNotification(1, "b", {});
        await emptyInboxForUser(1);
        const result = await getNotificationsForUser(1);
        expect(result).toEqual([]);
    });

    it("does not delete notifications belonging to other users", async () => {
        await createNotification(1, "a", {});
        await createNotification(2, "b", {});
        await emptyInboxForUser(1);

        const user2Notifications = await getNotificationsForUser(2);
        expect(user2Notifications).toHaveLength(1);
    });

    it("is a no-op when the user has no notifications", async () => {
        await expect(emptyInboxForUser(999)).resolves.not.toThrow();
    });
});
