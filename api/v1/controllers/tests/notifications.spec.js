const request = require("supertest");
const jwt = require("jsonwebtoken");
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

const getNotifications = require("../notifications/get-notifications");
const markNotificationRead = require("../notifications/mark-notification-read");
const deleteNotification = require("../notifications/delete-notification");
const { privateKey } = require("@modules/config");

const app = createTestApp(getNotifications, markNotificationRead, deleteNotification);

let tokens;
let user;

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

beforeEach(async () => {
    const seeded = await seedAuthenticatedUser(mockDatabase);
    tokens = seeded.tokens;
    user = seeded.user;
});

afterEach(async () => {
    await mockDatabase.reset();
    clearClassStateStore();
});

afterAll(async () => {
    await mockDatabase.close();
});

async function seedNotification(userId, type = "info", data = '{"message":"hello"}') {
    await mockDatabase.dbRun("INSERT INTO notifications (user_id, type, data) VALUES (?, ?, ?)", [userId, type, data]);
    return mockDatabase.dbGet("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1", [userId]);
}

function signOAuthAccessToken(userData, scopes) {
    return jwt.sign(
        {
            id: userData.id,
            permissions: 0,
            classPermissions: null,
            scopes: {
                global: [],
                class: [],
                app: scopes,
            },
            oauth: {
                appId: 1,
                scopes,
            },
        },
        privateKey,
        { algorithm: "RS256", expiresIn: "15m" }
    );
}

describe("POST /api/v1/notifications", () => {
    it("creates a notification for the authenticated user", async () => {
        const res = await request(app)
            .post("/api/v1/notifications")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ type: "info", data: { message: "hello" } });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.notificationId).toBeGreaterThan(0);

        const notification = await mockDatabase.dbGet("SELECT * FROM notifications WHERE id = ?", [res.body.data.notificationId]);
        expect(notification).toMatchObject({
            user_id: user.id,
            type: "info",
            data: JSON.stringify({ message: "hello" }),
        });
    });

    it("allows OAuth app tokens with app.notifications.send to create notifications", async () => {
        const accessToken = signOAuthAccessToken(user, ["app.notifications.send"]);

        const res = await request(app)
            .post("/api/v1/notifications")
            .set("Authorization", `Bearer ${accessToken}`)
            .send({ type: "app", data: { message: "from app" } });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        const notification = await mockDatabase.dbGet("SELECT * FROM notifications WHERE id = ?", [res.body.data.notificationId]);
        expect(notification.user_id).toBe(user.id);
        expect(notification.type).toBe("app");
    });

    it("requires app.notifications.send for OAuth app tokens", async () => {
        const accessToken = signOAuthAccessToken(user, ["app.notifications.read"]);

        const res = await request(app)
            .post("/api/v1/notifications")
            .set("Authorization", `Bearer ${accessToken}`)
            .send({ type: "app", data: { message: "from app" } });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when notification data is not an object", async () => {
        const res = await request(app)
            .post("/api/v1/notifications")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ type: "info", data: "not-object" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});

describe("GET /api/v1/notifications", () => {
    it("returns an empty array when the user has no notifications", async () => {
        const res = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.notifications).toEqual([]);
        expect(res.body.data.pagination).toEqual({
            total: 0,
            limit: 20,
            offset: 0,
            hasMore: false,
        });
    });

    it("returns paginated notifications for the authenticated user", async () => {
        await seedNotification(user.id, "info", '{"msg":"first"}');
        await seedNotification(user.id, "alert", '{"msg":"second"}');

        const res = await request(app).get("/api/v1/notifications?limit=1").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.notifications).toHaveLength(1);
        expect(res.body.data.pagination).toEqual({
            total: 2,
            limit: 1,
            offset: 0,
            hasMore: true,
        });
    });

    it("supports offset pagination", async () => {
        await seedNotification(user.id, "info", '{"msg":"first"}');
        await seedNotification(user.id, "alert", '{"msg":"second"}');

        const res = await request(app).get("/api/v1/notifications?limit=1&offset=1").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.notifications).toHaveLength(1);
        expect(res.body.data.pagination).toEqual({
            total: 2,
            limit: 1,
            offset: 1,
            hasMore: false,
        });
    });

    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/notifications");

        expect(res.status).toBe(401);
    });

    it("requires app.notifications.read for OAuth app tokens", async () => {
        const accessToken = signOAuthAccessToken(user, ["app.profile.read"]);

        const res = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("allows OAuth app tokens with app.notifications.read to read notifications", async () => {
        await seedNotification(user.id, "info", '{"msg":"oauth"}');
        const accessToken = signOAuthAccessToken(user, ["app.notifications.read"]);

        const res = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.notifications).toHaveLength(1);
    });
});

describe("GET /api/v1/notifications/:id", () => {
    it("returns 200 for the user's own notification", async () => {
        const notification = await seedNotification(user.id, "info", '{"msg":"test"}');

        const res = await request(app).get(`/api/v1/notifications/${notification.id}`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.notification.id).toBe(notification.id);
    });

    it("returns 404 for a non-existent notification", async () => {
        const res = await request(app).get("/api/v1/notifications/99999").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
    });

    it("returns 404 for another user's notification", async () => {
        const otherUserId = user.id + 1000;
        const otherNotification = await seedNotification(otherUserId, "info", '{"msg":"secret"}');

        const res = await request(app).get(`/api/v1/notifications/${otherNotification.id}`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
    });

    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/notifications/1");

        expect(res.status).toBe(401);
    });
});

describe("POST /api/v1/notifications/:id/mark-read", () => {
    it("marks a notification as read and returns it", async () => {
        const notification = await seedNotification(user.id, "info", '{"msg":"unread"}');
        expect(notification.is_read).toBe(0);

        const res = await request(app)
            .post(`/api/v1/notifications/${notification.id}/mark-read`)
            .set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.notification.is_read).toBe(1);

        const updated = await mockDatabase.dbGet("SELECT * FROM notifications WHERE id = ?", [notification.id]);
        expect(updated.is_read).toBe(1);
    });

    it("returns 404 for a non-existent notification", async () => {
        const res = await request(app).post("/api/v1/notifications/99999/mark-read").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
    });

    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/notifications/1/mark-read");

        expect(res.status).toBe(401);
    });

    it("does not allow OAuth app tokens to mark notifications read", async () => {
        const notification = await seedNotification(user.id, "info", '{"msg":"unread"}');
        const accessToken = signOAuthAccessToken(user, ["app.notifications.read"]);

        const res = await request(app).post(`/api/v1/notifications/${notification.id}/mark-read`).set("Authorization", `Bearer ${accessToken}`);

        expect(res.status).toBe(403);
        const updated = await mockDatabase.dbGet("SELECT * FROM notifications WHERE id = ?", [notification.id]);
        expect(updated.is_read).toBe(0);
    });
});

describe("DELETE /api/v1/notifications/:id", () => {
    it("deletes the notification and returns success", async () => {
        const notification = await seedNotification(user.id, "info", '{"msg":"delete me"}');

        const res = await request(app).delete(`/api/v1/notifications/${notification.id}`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const deleted = await mockDatabase.dbGet("SELECT * FROM notifications WHERE id = ?", [notification.id]);
        expect(deleted).toBeUndefined();
    });

    it("returns 404 for a non-existent notification", async () => {
        const res = await request(app).delete("/api/v1/notifications/99999").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
    });

    it("returns 401 without authentication", async () => {
        const res = await request(app).delete("/api/v1/notifications/1");

        expect(res.status).toBe(401);
    });
});

describe("DELETE /api/v1/notifications", () => {
    it("deletes all notifications for the user and returns success", async () => {
        await seedNotification(user.id, "info", '{"msg":"one"}');
        await seedNotification(user.id, "alert", '{"msg":"two"}');

        const res = await request(app).delete("/api/v1/notifications").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const remaining = await mockDatabase.dbGetAll("SELECT * FROM notifications WHERE user_id = ?", [user.id]);
        expect(remaining).toHaveLength(0);
    });

    it("returns 401 without authentication", async () => {
        const res = await request(app).delete("/api/v1/notifications");

        expect(res.status).toBe(401);
    });
});
