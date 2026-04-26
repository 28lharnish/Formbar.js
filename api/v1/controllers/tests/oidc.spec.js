const request = require("supertest");
const express = require("express");
const session = require("express-session");

const mockOidcModule = {
    getClient: jest.fn(),
    getAvailableProviders: jest.fn(),
    getOpenIdClient: jest.fn(),
};

const mockAuthService = {
    oidcOAuthLogin: jest.fn(),
};

const mockClassStateStore = {
    getUser: jest.fn(),
    setUser: jest.fn(),
};

const mockOpenIdClient = {
    randomPKCECodeVerifier: jest.fn(),
    calculatePKCECodeChallenge: jest.fn(),
    randomState: jest.fn(),
    randomNonce: jest.fn(),
    buildAuthorizationUrl: jest.fn(),
    authorizationCodeGrant: jest.fn(),
    fetchUserInfo: jest.fn(),
    skipSubjectCheck: Symbol("skipSubjectCheck"),
};

jest.mock("@modules/oidc.js", () => mockOidcModule);
jest.mock("@modules/config", () => ({
    frontendUrl: "http://localhost:3000",
}));
jest.mock("@services/auth-service", () => mockAuthService);
jest.mock("@services/classroom-service", () => ({
    classStateStore: mockClassStateStore,
}));
jest.mock("@services/student-service", () => ({
    createStudentFromUserData: jest.fn((userData) => userData),
}));
jest.mock("openid-client", () => ({
    __esModule: true,
    ...mockOpenIdClient,
    default: mockOpenIdClient,
}));

const providersController = require("../auth/oidc/providers");

function createSessionTestApp() {
    require("express-async-errors");

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(
        session({
            secret: "oidc-test-secret",
            resave: false,
            saveUninitialized: false,
        })
    );

    app.use((req, res, next) => {
        req.infoEvent = jest.fn();
        req.warnEvent = jest.fn();
        req.errorEvent = jest.fn();
        req.logEvent = jest.fn();
        next();
    });

    const router = express.Router();
    providersController(router);
    app.use("/api/v1", router);
    app.use(require("@middleware/error-handler"));
    return app;
}

describe("OIDC callback redirects", () => {
    let app;

    beforeEach(() => {
        app = createSessionTestApp();

        mockOidcModule.getClient.mockReturnValue({ id: "provider-client" });
        mockOidcModule.getAvailableProviders.mockReturnValue(["google"]);
        mockOidcModule.getOpenIdClient.mockResolvedValue(mockOpenIdClient);

        mockOpenIdClient.randomPKCECodeVerifier.mockReturnValue("verifier-123");
        mockOpenIdClient.calculatePKCECodeChallenge.mockResolvedValue("challenge-123");
        mockOpenIdClient.randomState.mockReturnValue("state-123");
        mockOpenIdClient.randomNonce.mockReturnValue("nonce-123");
        mockOpenIdClient.buildAuthorizationUrl.mockReturnValue(new URL("https://provider.example/authorize"));
        mockOpenIdClient.authorizationCodeGrant.mockResolvedValue({
            claims: () => ({
                email: "oidc@example.com",
                email_verified: true,
                name: "OIDC User",
            }),
            access_token: "provider-access-token",
        });
        mockOpenIdClient.fetchUserInfo.mockResolvedValue({});

        mockAuthService.oidcOAuthLogin.mockResolvedValue({
            tokens: {
                accessToken: "formbar-access-token",
                refreshToken: "formbar-refresh-token",
                legacyToken: "formbar-legacy-token",
            },
            user: {
                id: 7,
                email: "oidc@example.com",
                displayName: "OIDC User",
            },
        });

        mockClassStateStore.getUser.mockReturnValue(undefined);
        mockClassStateStore.setUser.mockClear();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("redirects the callback to the stored client URL and stores tokens in HttpOnly cookies", async () => {
        const agent = request.agent(app);

        const startRes = await agent.get("/api/v1/auth/oidc/google").query({ origin: "http://localhost:3000/login?redirect=%2Fclasses" });

        expect(startRes.status).toBe(302);

        const callbackRes = await agent.get("/api/v1/auth/oidc/google/callback").query({
            code: "provider-code",
            state: "state-123",
        });

        expect(callbackRes.status).toBe(302);

        const redirectLocation = new URL(callbackRes.headers.location);
        expect(`${redirectLocation.origin}${redirectLocation.pathname}`).toBe("http://localhost:3000/login");
        expect(redirectLocation.searchParams.get("redirect")).toBe("/classes");
        expect(redirectLocation.searchParams.get("oidc")).toBe("success");
        expect(redirectLocation.searchParams.get("accessToken")).toBeNull();
        expect(callbackRes.headers["set-cookie"].join(";")).toContain("formbar_access_token=formbar-access-token");
        expect(callbackRes.headers["set-cookie"].join(";")).toContain("HttpOnly");
    });

    it("falls back to the configured frontend login callback when no origin was stored", async () => {
        const agent = request.agent(app);

        await agent.get("/api/v1/auth/oidc/google");

        const callbackRes = await agent.get("/api/v1/auth/oidc/google/callback").query({
            code: "provider-code",
            state: "state-123",
        });

        expect(callbackRes.status).toBe(302);

        const redirectLocation = new URL(callbackRes.headers.location);
        expect(`${redirectLocation.origin}${redirectLocation.pathname}`).toBe("http://localhost:3000/login");
        expect(redirectLocation.searchParams.get("oidc")).toBe("success");
        expect(redirectLocation.searchParams.get("accessToken")).toBeNull();
        expect(callbackRes.headers["set-cookie"].join(";")).toContain("formbar_refresh_token=formbar-refresh-token");
    });

    it("rejects an untrusted callback origin", async () => {
        const agent = request.agent(app);

        const startRes = await agent.get("/api/v1/auth/oidc/google").query({ origin: "https://evil.example/callback" });

        expect(startRes.status).toBe(400);
        expect(startRes.body.error.message).toMatch(/not allowed/i);
    });
});
