// Support module aliases for importing
require("module-alias/register");

// Imported modules
const express = require("express");
require("express-async-errors"); // To handle async errors in express routes

const session = require("express-session"); // For storing client login data
const crypto = require("crypto");
const fs = require("fs");
require("dotenv").config(); // For environment variables

// If the database does not exist, then prompt the user to initialize it and exit
if (!fs.existsSync("database/database.db")) {
    console.log('The database file does not exist. Please run "npm run init-db" to initialize the database.');
    return;
}

// Custom modules
const { initSocketRoutes } = require("./sockets/init.js");
const { app, io, http } = require("@modules/web-server.js");
const { settings } = require("@modules/config.js");
const { socketStateStore, INACTIVITY_LIMIT } = require("./sockets/middleware/inactivity");
const NotFoundError = require("@errors/not-found-error");

const { logout } = require("@services/user-service");
const { rateLimiter } = require("@middleware/rate-limiter");
const { ensureFormbarDeveloperPool } = require("@services/bootstrap-service");
const { parseTrustProxySetting } = require("@modules/proxy-trust");

// Create session for user information to be transferred from page to page
const sessionMiddleware = session({
    secret: crypto.randomBytes(256).toString("hex"), // Used to sign into the session via cookies
    resave: false, // Used to prevent resaving back to the session store, even if it wasn't modified
    saveUninitialized: false, // Forces a session that is new, but not modified, or 'uninitialized' to be saved to the session store
});

const errorHandlerMiddleware = require("@middleware/error-handler");
const requestLoggerMiddleware = require("@middleware/request-logger");
const { initializeAvailableProviders, getAvailableProviders } = require("@modules/oidc");

// Initialize the available providers for logging into Formbar through OAuth
initializeAvailableProviders().catch((error) => {
    console.error("Failed to initialize available OIDC providers during startup.", error);
    process.exit(1);
});

// Trust the first proxy (nginx) so that req.ip returns the real client IP
// from the X-Forwarded-For header instead of nginx's loopback address.
// Without this, all requests appear to come from the same IP and rate limiting
// is applied globally rather than per-user.
app.set("trust proxy", parseTrustProxySetting(process.env.TRUST_PROXY));

// Apply logger middleware
// This should always be applied first so that we can log when anything goes wrong
app.use(requestLoggerMiddleware);

// Connect rate limiter middleware
app.use(rateLimiter);

// Connect session middleware to express
app.use(sessionMiddleware);

// For further uses on this use this link: https://socket.io/how-to/use-with-express-session
// Uses a middleware function to successfully transmit data between the user and server
// adds session middleware to socket.io
io.use((socket, next) => {
    sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// Block socket connections from banned IPs
io.use((socket, next) => {
    try {
        let ip = socket.handshake.address;
        if (ip && ip.startsWith("::ffff:")) ip = ip.slice(7);

        // @TODO fix
        // if (authentication.checkIPBanned(ip)) {
        //     return next(new Error("IP banned"));
        // }
        next();
    } catch (err) {
        next(err);
    }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Begin checking for any users who have not performed any actions for a specified amount of time
const INACTIVITY_CHECK_TIME = 60000; // 1 Minute
setInterval(() => {
    const currentTime = Date.now();
    for (const email of Object.keys(socketStateStore.getLastActivities())) {
        const userActivities = socketStateStore.getUserLastActivities(email);
        if (!userActivities) continue;

        for (const [socketId, activity] of Object.entries(userActivities)) {
            if (currentTime - activity.time > INACTIVITY_LIMIT) {
                // Check if this is an API socket - API sockets should not timeout
                let isApiSocket = false;
                if (activity.socket && activity.socket.rooms) {
                    for (const room of activity.socket.rooms) {
                        if (room.startsWith("api-")) {
                            isApiSocket = true;
                            break;
                        }
                    }
                }

                // Only logout non-API sockets
                if (!isApiSocket) {
                    logout(activity.socket); // Log the user out
                    socketStateStore.clearUserLastActivities(email);
                }
            }
        }
    }
}, INACTIVITY_CHECK_TIME);

// @TODO fix
// const REFRESH_TOKEN_CHECK_TIME = 1000 * 60 * 60; // 1 hour
// authentication.cleanRefreshTokens();
// setInterval(async () => {
//     authentication.cleanRefreshTokens();
// }, REFRESH_TOKEN_CHECK_TIME);

// Check if an IP is banned
app.use((req, res, next) => {
    let ip = req.ip;
    if (!ip) return next();
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);

    // @TODO: fix
    // Check if the user is ip banned
    // If the user is not ip banned and is on the ip-banned page, redirect them to the home page
    // const isIPBanned = authentication.checkIPBanned(ip);
    if (req.path === "/ip-banned" && isIPBanned) {
        return next();
    } else if (req.path === "/ip-banned" && !isIPBanned) {
        return res.redirect("/");
    }

    // Redirect to the IP banned page if they are banned
    // if (isIPBanned) {
    //     return res.redirect("/ip-banned");
    // }

    next();
});

function getJSFiles(dir, base = dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory() && entry.name !== "tests") {
            results = results.concat(getJSFiles(full, base));
        } else if (entry.isFile() && entry.name.endsWith(".js") && !entry.name.endsWith(".spec.js")) {
            results.push(full.slice(base.length + 1)); // relative path from base folder
        }
    }
    return results;
}

const LEGACY_API_WARNING =
    '299 - "Deprecated API: Non-versioned /api endpoints are deprecated. Use /api/v1 endpoints instead. This compatibility layer will be removed in a future version."';

function attachLegacyApiDeprecationHeaders(req, res, next) {
    res.setHeader("X-Deprecated", "Use /api/v1 endpoints instead");
    res.setHeader("Deprecation", "true");
    res.setHeader("Sunset", "Tue, 01 Sep 2026 00:00:00 GMT");
    res.append("Warning", LEGACY_API_WARNING);
    next();
}

// This is hacky, but it works, I suppose.
function rewriteLegacyApiPaths(req, res, next) {
    req.url = req.url.replace(/^\/me(?=\/|$|\?)/, "/user/me");
    req.url = req.url.replace(/^\/user\/([^/]+)\/ownedClasses(?=\/|$|\?)/, "/user/$1/classes");
    next();
}

// Import API routes
const apiVersionFolders = fs.readdirSync("./api");
for (const apiVersionFolder of apiVersionFolders) {
    const controllerFolders = fs.readdirSync(`./api/${apiVersionFolder}`).filter((file) => file === "controllers");
    for (const controllerFolder of controllerFolders) {
        const router = express.Router();

        const routeFiles = getJSFiles(`./api/${apiVersionFolder}/${controllerFolder}`);
        const middlewareFiles = routeFiles.filter((routeFile) => routeFile.startsWith("middleware/"));
        const nonMiddlewareFiles = routeFiles.filter((routeFile) => !routeFile.startsWith("middleware/"));

        for (const routeFile of middlewareFiles) {
            const registerRoute = require(`./api/${apiVersionFolder}/${controllerFolder}/${routeFile}`);
            if (typeof registerRoute === "function") {
                registerRoute(router);
            }
        }

        for (const routeFile of nonMiddlewareFiles) {
            const registerRoute = require(`./api/${apiVersionFolder}/${controllerFolder}/${routeFile}`);
            if (typeof registerRoute === "function") {
                registerRoute(router);
            }
        }

        app.use(`/api/${apiVersionFolder}`, router);

        // Backwards compatibility for legacy non-versioned API paths.
        if (apiVersionFolder === "v1") {
            app.use("/api", (req, res, next) => {
                // Keep /api/v{n} requests exclusively on their versioned mounts.
                if (/^\/v\d+(?:\/|$)/.test(req.path)) return next();

                attachLegacyApiDeprecationHeaders(req, res, () => {
                    rewriteLegacyApiPaths(req, res, () => router(req, res, next));
                });
            });
        }
    }
}

// Initialize websocket routes
initSocketRoutes();

// 404 handler for undefined routes
app.use((req, res, next) => {
    next(new NotFoundError("Resource not found"));
});

// Error handling middleware
app.use(errorHandlerMiddleware);

// Start the server

http.listen(settings.port, async () => {
    // Ensure that the Formbar Developer Pool exists
    try {
        await ensureFormbarDeveloperPool();
    } catch (err) {
        console.error("Failed to ensure Formbar Developer Pool exists:", err);
    }

    // Object.assign(authentication.whitelistedIps, await getIpAccess("whitelist"));
    // Object.assign(authentication.blacklistedIps, await getIpAccess("blacklist"));
    console.log(`Running on port: ${settings.port}`);

    const availableOIDCProviders = getAvailableProviders();
    if (!settings.emailEnabled) {
        console.log("Email functionality is disabled.");
    }

    if (!availableOIDCProviders.includes("google")) {
        console.log("Google OAuth is not available. Please configure Google OAuth in the environment variables to enable Google login.");
    }

    if (!availableOIDCProviders.includes("microsoft")) {
        console.log("Microsoft OAuth is not available. Please configure Microsoft OAuth in the environment variables to enable Microsoft login.");
    }

    if (!settings.emailEnabled || availableOIDCProviders.length < 2) {
        console.log(
            'To enable the disabled function(s), follow the related instructions under "Hosting Formbar.js Locally" in the Formbar wiki page at https://github.com/csmith1188/Formbar.js/wiki'
        );
    }
});
