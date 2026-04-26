const NotFoundError = require("@errors/not-found-error");
const { logEvent, getLogger } = require("@modules/logger");

let openIdClientPromise;
/**
 * Load the OIDC client library once so provider discovery can reuse the same import.
 *
 * @returns {*}
 */
function getOpenIdClient() {
    if (!openIdClientPromise) {
        openIdClientPromise = import("openid-client");
    }

    return openIdClientPromise;
}

const clients = new Map();

/**
 * Return the cached discovery client for a configured provider.
 *
 * @param {*} provider - provider.
 * @returns {*}
 */
function getClient(provider) {
    if (!clients.has(provider)) {
        throw new NotFoundError(`Client for provider ${provider} not found`);
    }
    return clients.get(provider);
}

const possibleProviders = ["google", "microsoft"];
/**
 * List the OIDC providers that have enough environment config to be used for login.
 *
 * @returns {*}
 */
function getAvailableProviders() {
    const availableProviders = [];
    for (const provider of possibleProviders) {
        const issuer = process.env[`${provider.toUpperCase()}_OIDC_ISSUER`];
        const clientId = process.env[`${provider.toUpperCase()}_OIDC_CLIENT_ID`];
        const clientSecret = process.env[`${provider.toUpperCase()}_OIDC_CLIENT_SECRET`];

        // If one of these is missing, mark it as unavailable
        if (!issuer || !clientId || !clientSecret) {
            continue;
        }

        availableProviders.push(provider);
    }

    return availableProviders;
}

/**
 * Discover and cache the configured OIDC providers at startup.
 *
 * @returns {Promise<*>}
 */
async function initializeAvailableProviders() {
    const client = await getOpenIdClient();
    const providers = getAvailableProviders();
    for (const provider of providers) {
        try {
            let issuer = process.env[`${provider.toUpperCase()}_OIDC_ISSUER`];
            const clientId = process.env[`${provider.toUpperCase()}_OIDC_CLIENT_ID`];
            const clientSecret = process.env[`${provider.toUpperCase()}_OIDC_CLIENT_SECRET`];
            const tenantId = process.env[`${provider.toUpperCase()}_OIDC_TENANT_ID`];

            // If a tenant ID is provided, replace the common issuer with the tenant ID
            // This is necessary for Microsoft Azure OAuth2
            if (tenantId) {
                issuer = issuer.replaceAll("common", tenantId);
            }

            const config = await client.discovery(new URL(issuer), clientId, clientSecret);
            clients.set(provider, config);
        } catch (err) {
            logEvent(getLogger(), "oidc.error", {
                provider,
                error: err.message,
            });
        }
    }
}

module.exports = {
    getAvailableProviders,
    initializeAvailableProviders,
    getClient,
    getOpenIdClient,
};
