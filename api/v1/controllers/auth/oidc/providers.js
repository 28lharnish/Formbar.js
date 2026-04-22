const oidc = require("@modules/oidc.js");
const authService = require("@services/auth-service");
const ValidationError = require("@errors/validation-error");
const NotFoundError = require("@errors/not-found-error");
const { frontendUrl } = require("@modules/config");
const { classStateStore } = require("@services/classroom-service");
const { createStudentFromUserData } = require("@services/student-service");

/**
 * * Get a configured OIDC client or throw when unsupported.
 * @param {string} provider - Provider name.
 * @returns {Object}
 */
function assertProviderSupported(provider) {
    try {
        return oidc.getClient(provider);
    } catch (err) {
        throw new NotFoundError("Requested provider not found.", {
            event: "auth.oidc.provider.not_found",
            reason: "provider_not_found",
        });
    }
}

/**
 * * Build the OIDC callback URL for a provider.
 * @param {import("express").Request} req - Request object.
 * @param {string} provider - Provider name.
 * @returns {string}
 */
function buildCallbackUrl(req, provider) {
    return `${req.protocol}://${req.get("host")}/api/v1/auth/oidc/${provider}/callback`;
}

/**
 * * Build the frontend redirect URL after OIDC login.
 * @param {import("express").Request} req - Request object.
 * @param {Object} tokens - Issued auth tokens.
 * @param {Object} userData - User data.
 * @returns {string|null}
 */
function getRedirectTarget(req, tokens, userData) {
    const clientOrigin = req.session?.oauthOrigin || (frontendUrl ? new URL("/login", frontendUrl).toString() : null);
    if (!clientOrigin) {
        return null;
    }

    delete req.session.oauthOrigin;

    const redirect = new URL(clientOrigin);
    redirect.searchParams.set("accessToken", tokens.accessToken);
    redirect.searchParams.set("refreshToken", tokens.refreshToken);
    if (tokens.legacyToken) {
        redirect.searchParams.set("legacyToken", tokens.legacyToken);
    }

    redirect.searchParams.set("userId", String(userData.id));
    redirect.searchParams.set("email", userData.email);
    redirect.searchParams.set("displayName", userData.displayName);
    return redirect.toString();
}

/**
 * * Get an email address from OIDC claims.
 * @param {string} provider - Provider name.
 * @param {Object} claims - Provider claims.
 * @returns {string|null}
 */
function getEmailFromClaims(provider, claims) {
    const directEmail = typeof claims?.email === "string" ? claims.email : null;
    if (directEmail) {
        return directEmail;
    }

    if (provider === "microsoft") {
        const preferredUsername = claims?.unique_name;
        if (preferredUsername && preferredUsername.includes("@")) {
            return preferredUsername;
        }
    }

    return null;
}

/**
 * * Get a display name from OIDC claims.
 * @param {Object} claims - Provider claims.
 * @param {string} email - User email.
 * @returns {string}
 */
function getDisplayNameFromClaims(claims, email) {
    const name = typeof claims?.name === "string" ? claims.name.trim() : "";
    if (name) {
        return name;
    }

    const givenName = typeof claims?.given_name === "string" ? claims.given_name.trim() : "";
    const familyName = typeof claims?.family_name === "string" ? claims.family_name.trim() : "";
    const combinedName = `${givenName} ${familyName}`.trim();
    return combinedName || email;
}

/**
 * * Register providers controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/auth/oidc/providers:
     *   get:
     *     summary: List available OIDC providers
     *     tags:
     *       - Authentication
     *     description: Returns the configured OpenID Connect providers that can be used for login.
     *     responses:
     *       200:
     *         description: OIDC providers returned successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 data:
     *                   type: object
     *                   properties:
     *                     providers:
     *                       type: array
     *                       items:
     *                         type: string
     *                       example:
     *                         - google
     *                         - microsoft
     */
    router.get("/auth/oidc/providers", (req, res) => {
        res.status(200).json({
            success: true,
            data: {
                providers: oidc.getAvailableProviders(),
            },
        });
    });

    /**
     * @swagger
     * /api/v1/auth/oidc/{provider}:
     *   get:
     *     summary: Start OIDC login flow
     *     tags:
     *       - Authentication
     *     description: |
     *       Starts the OpenID Connect authorization code flow for the selected provider and
     *       redirects the user to the provider's authorization page.
     *     parameters:
     *       - in: path
     *         name: provider
     *         required: true
     *         schema:
     *           type: string
     *         description: OIDC provider identifier returned by `/api/v1/auth/oidc/providers`
     *         example: google
     *       - in: query
     *         name: origin
     *         schema:
     *           type: string
     *           format: uri
     *         description: Optional frontend URL to redirect back to after authentication completes
     *         example: http://localhost:3000/login?redirect=%2Fclasses
     *     responses:
     *       302:
     *         description: Redirects to the provider's authorization URL
     *       404:
     *         description: Requested OIDC provider is not configured
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.get("/auth/oidc/:provider", async (req, res) => {
        const provider = req.params.provider;
        const providerClient = assertProviderSupported(provider);
        const client = await oidc.getOpenIdClient();

        const codeVerifier = client.randomPKCECodeVerifier();
        const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
        const state = client.randomState();
        const nonce = client.randomNonce();

        req.session.oidcAuth = {
            provider,
            codeVerifier,
            state,
            nonce,
        };

        if (req.query.origin) {
            req.session.oauthOrigin = String(req.query.origin);
        }

        const authUrl = client.buildAuthorizationUrl(providerClient, {
            redirect_uri: buildCallbackUrl(req, provider),
            scope: "openid email profile",
            response_type: "code",
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            state,
            nonce,
        });

        res.redirect(authUrl.toString());
    });

    /**
     * @swagger
     * /api/v1/auth/oidc/{provider}/callback:
     *   get:
     *     summary: Complete OIDC login flow
     *     tags:
     *       - Authentication
     *     description: |
     *       Handles the provider callback, exchanges the authorization code for tokens, and
     *       signs the user into Formbar.
     *
     *       If an `origin` value was supplied when the flow started, the response redirects back
     *       to that frontend URL with tokens appended in the fragment. Otherwise, a JSON payload
     *       containing the issued tokens and user profile is returned.
     *     parameters:
     *       - in: path
     *         name: provider
     *         required: true
     *         schema:
     *           type: string
     *         description: OIDC provider identifier returned by `/api/v1/auth/oidc/providers`
     *         example: google
     *       - in: query
     *         name: code
     *         required: true
     *         schema:
     *           type: string
     *         description: Authorization code returned by the provider
     *       - in: query
     *         name: state
     *         required: true
     *         schema:
     *           type: string
     *         description: State value returned by the provider
     *     responses:
     *       200:
     *         description: OIDC login completed successfully and tokens returned as JSON
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 data:
     *                   type: object
     *                   properties:
     *                     accessToken:
     *                       type: string
     *                     refreshToken:
     *                       type: string
     *                     legacyToken:
     *                       type: string
     *                     user:
     *                       type: object
     *                       properties:
     *                         id:
     *                           type: integer
     *                           example: 7
     *                         email:
     *                           type: string
     *                           format: email
     *                           example: oidc@example.com
     *                         displayName:
     *                           type: string
     *                           example: OIDC User
     *       302:
     *         description: Redirects to the frontend callback URL with issued tokens
     *       400:
     *         description: Authentication session is invalid, expired, or missing required provider claims
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ValidationError'
     *       404:
     *         description: Requested OIDC provider is not configured
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.get("/auth/oidc/:provider/callback", async (req, res) => {
        const provider = req.params.provider;
        const providerClient = assertProviderSupported(provider);
        const authSession = req.session?.oidcAuth;

        if (!authSession || authSession.provider !== provider) {
            throw new ValidationError("Authentication session is invalid or has expired.", {
                event: "auth.oidc.callback.invalid_session",
                reason: "missing_session",
            });
        }

        const client = await oidc.getOpenIdClient();
        const currentUrl = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
        const tokens = await client.authorizationCodeGrant(providerClient, currentUrl, {
            pkceCodeVerifier: authSession.codeVerifier,
            expectedState: authSession.state,
            expectedNonce: authSession.nonce,
        });

        delete req.session.oidcAuth;

        let claims = tokens.claims() || {};
        if ((!claims.email || claims.email_verified === undefined) && tokens.access_token) {
            const userInfo = await client.fetchUserInfo(providerClient, tokens.access_token, claims.sub || client.skipSubjectCheck);
            claims = { ...userInfo, ...claims };
        }

        const email = getEmailFromClaims(provider, claims);
        if (!email) {
            throw new ValidationError("Could not retrieve email from OAuth account.", {
                event: "auth.oidc.callback.no_email",
                reason: "email_not_found",
            });
        }

        const displayName = getDisplayNameFromClaims(claims, email);
        const result = await authService.oidcOAuthLogin(provider, email, displayName, {
            emailVerified: claims.email_verified !== false,
        });

        const { user: userData } = result;
        if (!classStateStore.getUser(userData.email)) {
            classStateStore.setUser(userData.email, createStudentFromUserData(userData, { isGuest: false }));
        }

        const redirectTarget = getRedirectTarget(req, result.tokens, userData);
        if (redirectTarget) {
            req.infoEvent("auth.oidc.callback.redirect", "Redirecting to SPA after OIDC OAuth", { provider });
            return res.redirect(redirectTarget);
        }

        res.status(200).json({
            success: true,
            data: {
                ...result.tokens,
                user: {
                    id: userData.id,
                    email: userData.email,
                    displayName: userData.displayName,
                },
            },
        });
    });
};
