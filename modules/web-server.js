const express = require("express");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const cors = require("cors");

// Create the express server and attach socket.io to it
/**
 * Create the Express app, HTTP server, Socket.IO server, and Swagger docs wiring.
 *
 * @returns {*}
 */
function createServer() {
    const app = express();
    const http = require("http").createServer(app);
    const io = require("socket.io")(http, {
        cors: {
            origin: "*",
        },
    });

    // Enables CORS if not using nginx or if ENABLE_CORS is set to true. This allows the API to be accessed from other origins, which is useful for development and if the frontend is hosted separately from the backend.
    process.env.ENABLE_CORS == "true" && app.use(cors({ origin: "*" }));

    const swaggerDocOptions = {
        definition: {
            openapi: "3.0.0",
            info: {
                title: "Formbar API",
                version: "3.0.0",
                description: "HTTP API documentation for Formbar.js.",
            },
            tags: [
                { name: "Authentication", description: "User authentication and registration", "x-order": 1 },
                { name: "System", description: "System utilities and certificates", "x-order": 2 },
                { name: "Users", description: "User management and profile operations", "x-order": 3 },
                { name: "Class", description: "Class creation and basic operations", "x-order": 4 },
                { name: "Class - Polls", description: "Polling system within classes", "x-order": 5 },
                { name: "Class - Breaks", description: "Break request system", "x-order": 6 },
                { name: "Class - Help", description: "Help ticket system", "x-order": 7 },
                { name: "Digipogs", description: "Virtual currency management", "x-order": 10 },
                { name: "IP Management", description: "IP whitelist/blacklist management", "x-order": 11 },
                { name: "Manager", description: "Manager/admin functions", "x-order": 12 },
                { name: "Notifications", description: "User notification management", "x-order": 13 },
                { name: "OAuth", description: "OAuth 2.0 authorization flow", "x-order": 14 },
                { name: "Apps", description: "Application registration and management", "x-order": 15 },
                { name: "Pools", description: "Digipog pool management", "x-order": 16 },
            ],
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: "http",
                        scheme: "bearer",
                        bearerFormat: "JWT",
                        description: "JWT access token obtained from /api/v1/auth/login or /api/v1/auth/refresh",
                    },
                    apiKeyAuth: {
                        type: "apiKey",
                        in: "header",
                        name: "X-API-Key",
                        description: "API key associated with your account. Can be retrieved from your user profile.",
                    },
                },
                "x-formbar": {
                    nodeEnv: process.env.NODE_ENV || "production",
                },
            },
        },
        apis: ["./api/v1/**/*.js", "./docs/components/**/*.yaml"],
    };

    const specs = swaggerJsdoc(swaggerDocOptions);

    // Sort paths by length (shorter first) before passing to Swagger UI
    if (specs.paths) {
        const sortedPaths = {};
        Object.keys(specs.paths)
            .sort((a, b) => {
                // Count path segments
                const segmentsA = a.split("/").length;
                const segmentsB = b.split("/").length;

                // If different number of segments, shorter path comes first
                if (segmentsA !== segmentsB) {
                    return segmentsA - segmentsB;
                }

                // If same number of segments, sort alphabetically
                return a.localeCompare(b);
            })
            .forEach((key) => {
                sortedPaths[key] = specs.paths[key];
            });
        specs.paths = sortedPaths;
    }

    app.get(["/docs.json", "/docs/openapi.json"], (req, res) => {
        res.json(specs);
    });

    app.use(
        "/docs",
        swaggerUi.serve,
        swaggerUi.setup(specs, {
            swaggerOptions: {
                operationsSorter: "method", // Group by HTTP method (GET, POST, etc.)
            },
        })
    );

    return { app, io, http };
}

const { app, io, http } = createServer();
module.exports = {
    app,
    io,
    http,
};
