const crypto = require("crypto");
const { dbGet, dbRun } = require("@modules/database");
const { sha256 } = require("@modules/crypto");
const { createPool } = require("@services/digipog-service");
const { createItem, addItemToInventory } = require("@services/inventory-service");
const ValidationError = require("@errors/validation-error");

const SHARES_PER_APP = 100;

/**
 * Create an app record, issue credentials, and seed the matching share item and pool.
 * @param {Object} appData - App data.
 * @param {string} appData.name - App name.
 * @param {string} appData.description - App description.
 * @param {number} appData.ownerId - Owner user ID.
 * @returns {Promise<Object>}
 */
function normalizeRedirectUris(redirectUris = []) {
    if (!Array.isArray(redirectUris)) {
        throw new ValidationError("redirectUris must be an array.");
    }

    const normalized = [];
    for (const redirectUri of redirectUris) {
        if (typeof redirectUri !== "string" || !redirectUri.trim()) {
            throw new ValidationError("Each redirect URI must be a non-empty string.");
        }

        let parsed;
        try {
            parsed = new URL(redirectUri);
        } catch {
            throw new ValidationError("Each redirect URI must be an absolute URL.");
        }

        if (!["http:", "https:"].includes(parsed.protocol)) {
            throw new ValidationError("Redirect URIs must use http or https.");
        }

        parsed.hash = "";
        normalized.push(parsed.toString());
    }

    return [...new Set(normalized)];
}

/**
 * Create an app record, issue credentials, and attach its redirect URIs.
 *
 * @param {Object} params - params.
 * @returns {Promise<*>}
 */
async function createApp({ name, description, ownerId, redirectUris = [] }) {
    const normalizedRedirectUris = normalizeRedirectUris(redirectUris);

    await dbRun("BEGIN TRANSACTION");

    try {
        const shareItemId = await createItem({
            name: `${name} Share`,
            description: `Share of ${name}`,
            stackSize: SHARES_PER_APP,
            iconUrl: null,
        });
        const poolId = await createPool({ name: `${name} Developer Pool`, description, ownerId });

        const apiKey = crypto.randomBytes(64).toString("hex");
        const apiSecret = crypto.randomBytes(256).toString("hex");
        const hashedAPIKey = sha256(apiKey);
        const hashedAPISecret = sha256(apiSecret);

        const appId = await dbRun(
            "INSERT INTO apps (name, description, owner_user_id, share_item_id, pool_id, api_key_hash, api_secret_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [name, description, ownerId, shareItemId, poolId, hashedAPIKey, hashedAPISecret]
        );

        for (const redirectUri of normalizedRedirectUris) {
            await dbRun("INSERT INTO app_redirect_uris (app_id, redirect_uri) VALUES (?, ?)", [appId, redirectUri]);
        }

        await addItemToInventory(ownerId, shareItemId, SHARES_PER_APP);
        await dbRun("COMMIT");

        return {
            appId,
            apiKey,
            apiSecret,
        };
    } catch (error) {
        await dbRun("ROLLBACK");
        throw error;
    }
}

/**
 * Validate OAuth Client Redirect.
 *
 * @param {Object} params - params.
 * @returns {Promise<*>}
 */
async function validateOAuthClientRedirect({ clientId, redirectUri }) {
    const normalizedRedirectUri = normalizeRedirectUris([redirectUri])[0];
    const app = await dbGet(
        `SELECT apps.id, apps.api_secret_hash
         FROM apps
         JOIN app_redirect_uris ON app_redirect_uris.app_id = apps.id
         WHERE apps.id = ?
           AND app_redirect_uris.redirect_uri = ?`,
        [clientId, normalizedRedirectUri]
    );

    return app ? { ...app, redirectUri: normalizedRedirectUri } : null;
}

/**
 * Validate OAuth Client Secret.
 *
 * @param {Object} params - params.
 * @returns {Promise<*>}
 */
async function validateOAuthClientSecret({ clientId, redirectUri, clientSecret }) {
    const app = await validateOAuthClientRedirect({ clientId, redirectUri });
    if (!app || typeof clientSecret !== "string" || !clientSecret.trim()) {
        return null;
    }

    return sha256(clientSecret) === app.api_secret_hash ? app : null;
}

module.exports = {
    createApp,
    normalizeRedirectUris,
    validateOAuthClientRedirect,
    validateOAuthClientSecret,
};
