const { dbGet, dbRun } = require("@modules/database");
const { sha256 } = require("@modules/crypto");
const { regenerateAPIKey, resolveAPIKey } = require("@services/api-key-service");
const { createPool } = require("@services/digipog-service");
const { registerItem, addItemToInventory } = require("@services/inventory-service");
const ValidationError = require("@errors/validation-error");
const crypto = require("crypto");

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
        const shareItemId = await registerItem({
            name: `${name} Share`,
            description: `Share of ${name}`,
            stackSize: SHARES_PER_APP,
            iconUrl: null,
        });
        const poolId = await createPool({ name: `${name} Developer Pool`, description, ownerId });

        const appId = await dbRun(
            "INSERT INTO apps (name, description, owner_user_id, share_item_id, pool_id) VALUES (?, ?, ?, ?, ?)",
            [name, description, ownerId, shareItemId, poolId]
        );

        for (const redirectUri of normalizedRedirectUris) {
            await dbRun("INSERT INTO app_redirect_uris (app_id, redirect_uri) VALUES (?, ?)", [appId, redirectUri]);
        }

        // Generate and store API key for the app (128 hex chars = 64 bytes)
        const apiKey = crypto.randomBytes(64).toString("hex");
        const apiSecret = crypto.randomBytes(256).toString("hex");
        const apiKeyHash = sha256(apiKey);
        
        await dbRun(
            "INSERT INTO api_keys (api_key_hash, entity_id, entity_type) VALUES (?, ?, ?)",
            [apiKeyHash, appId, "app"]
        );

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

async function getAppById(appId) {
    const app = await dbGet("SELECT id, name, description, owner_user_id AS ownerId FROM apps WHERE id = ?", [appId]);
    return app || null;
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
        `SELECT apps.id
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
async function validateOAuthAPIKey({ clientId, redirectUri, apiKey}) {
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
        return null;
    }
    
    const app = await resolveAPIKey(apiKey);
    if (!app) {
        return null;
    }

    return (app.id === Number(clientId)) ? { ...app, redirectUri } : null;
}

module.exports = {
    createApp,
    getAppById,
    normalizeRedirectUris,
    validateOAuthClientRedirect,
    validateOAuthAPIKey,
};
