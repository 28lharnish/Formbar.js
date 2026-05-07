/**
 * Tests for the legacy (non-versioned) API compatibility layer defined in app.js.
 *
 * Verifies:
 *  - rewriteLegacyApiPaths: /me → /user/me, /user/:id/ownedClasses → /user/:id/classes
 *  - attachLegacyApiDeprecationHeaders: X-Deprecated, Deprecation, Sunset, Warning
 *  - /api/v{n} requests are NOT intercepted by the legacy layer
 */

const request = require("supertest");
const express = require("express");

// Recreate the functions from app.js (they are not exported)
const LEGACY_API_WARNING =
    '299 - "Deprecated API: Non-versioned /api endpoints are deprecated. Use /api/v1 endpoints instead. This compatibility layer will be removed in a future version."';

function attachLegacyApiDeprecationHeaders(req, res, next) {
    res.setHeader("X-Deprecated", "Use /api/v1 endpoints instead");
    res.setHeader("Deprecation", "true");
    res.append("Warning", LEGACY_API_WARNING);
    next();
}

function rewriteLegacyApiPaths(req, res, next) {
    req.url = req.url.replace(/^\/me(?=\/|$|\?)/, "/user/me");
    req.url = req.url.replace(/^\/user\/([^/]+)\/ownedClasses(?=\/|$|\?)/, "/user/$1/classes");
    next();
}

/**
 * Creates a minimal Express app that mirrors the legacy API routing from app.js.
 * The v1 router has stub routes so we can verify rewrites land on the right handler.
 */
function createLegacyTestApp() {
    const app = express();
    app.use(express.json());

    const router = express.Router();

    // Stub routes that the legacy paths should resolve to after rewriting
    router.get("/user/me", (req, res) => {
        res.json({ success: true, route: "user-me" });
    });

    router.get("/user/:id/classes", (req, res) => {
        res.json({ success: true, route: "user-classes", id: req.params.id });
    });

    router.get("/config", (req, res) => {
        res.json({ success: true, route: "config" });
    });

    // Mount versioned route (same as app.js)
    app.use("/api/v1", router);

    // Legacy compatibility layer (mirrors app.js lines 208-218)
    app.use("/api", (req, res, next) => {
        if (/^\/v\d+(?:\/|$)/.test(req.path)) return next();

        attachLegacyApiDeprecationHeaders(req, res, () => {
            rewriteLegacyApiPaths(req, res, () => router(req, res, next));
        });
    });

    return app;
}

let app;

beforeAll(() => {
    app = createLegacyTestApp();
});

describe("rewriteLegacyApiPaths", () => {
    it("rewrites /api/me to /api/user/me", async () => {
        const res = await request(app).get("/api/me");

        expect(res.status).toBe(200);
        expect(res.body.route).toBe("user-me");
    });

    it("rewrites /api/user/42/ownedClasses to /api/user/42/classes", async () => {
        const res = await request(app).get("/api/user/42/ownedClasses");

        expect(res.status).toBe(200);
        expect(res.body.route).toBe("user-classes");
        expect(res.body.id).toBe("42");
    });

    it("passes through a normal legacy path without rewriting", async () => {
        const res = await request(app).get("/api/config");

        expect(res.status).toBe(200);
        expect(res.body.route).toBe("config");
    });
});

describe("attachLegacyApiDeprecationHeaders", () => {
    it("sets X-Deprecated header on legacy requests", async () => {
        const res = await request(app).get("/api/config");

        expect(res.headers["x-deprecated"]).toBe("Use /api/v1 endpoints instead");
    });

    it("sets Deprecation header to true", async () => {
        const res = await request(app).get("/api/config");

        expect(res.headers["deprecation"]).toBe("true");
    });

    it("sets Sunset header", async () => {
        const res = await request(app).get("/api/config");

        expect(res.headers["sunset"]).toBe("Tue, 01 Sep 2026 00:00:00 GMT");
    });

    it("sets Warning header with 299 code", async () => {
        const res = await request(app).get("/api/config");

        expect(res.headers["warning"]).toMatch(/299/);
        expect(res.headers["warning"]).toContain("Deprecated API");
    });

    it("does NOT set deprecation headers on versioned /api/v1 requests", async () => {
        const res = await request(app).get("/api/v1/config");

        expect(res.status).toBe(200);
        expect(res.headers["x-deprecated"]).toBeUndefined();
        expect(res.headers["deprecation"]).toBeUndefined();
    });
});

describe("versioned path bypass", () => {
    it("routes /api/v1/* directly to the versioned mount", async () => {
        const res = await request(app).get("/api/v1/user/me");

        expect(res.status).toBe(200);
        expect(res.body.route).toBe("user-me");
        expect(res.headers["x-deprecated"]).toBeUndefined();
    });

    it("does not intercept /api/v2 paths (falls through)", async () => {
        const res = await request(app).get("/api/v2/config");

        // No v2 router is mounted, so this should 404 (or whatever the fallback is)
        expect(res.status).not.toBe(200);
    });
});
