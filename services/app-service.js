const crypto = require("crypto");
const { dbRun } = require("@modules/database");
const { sha256 } = require("@modules/crypto");
const { createPool } = require("@services/digipog-service");
const { createItem, addItemToInventory } = require("@services/inventory-service");

const SHARES_PER_APP = 100;

/**
 * * Create an app record owned by a user.
 * @param {Object} appData - App data.
 * @param {string} appData.name - App name.
 * @param {string} appData.description - App description.
 * @param {number} appData.ownerId - Owner user ID.
 * @returns {Promise<Object>}
 */
async function createApp({ name, description, ownerId }) {
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

module.exports = {
    createApp,
};
