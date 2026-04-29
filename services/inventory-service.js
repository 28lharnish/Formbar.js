const { dbGet, dbGetAll, dbRun } = require("@modules/database");
const NotFoundError = require("@errors/not-found-error");

/**
 * Get a user inventory.
 * @param {number} userId - userId.
 * @returns {Promise<Object[]>}
 */
async function getUserInventory(userId) {
    const items = new Map();

    // gets all inventory rows (stored as item ID with quantity)
    const inventoryRows = await dbGetAll(
        `SELECT i.item_id, i.quantity,
                r.id, r.name, r.description, r.stack_size, r.image_url
         FROM inventory i
         INNER JOIN item_registry r ON r.id = i.item_id
         WHERE i.user_id = ?`,
        [userId],
    );

    for (const row of inventoryRows) {
        const itemInfo = {
            id: row.id,
            name: row.name,
            description: row.description,
            stack_size: row.stack_size,
            image_url: row.image_url,
            quantity: row.quantity,
        };

        const itemIndex = row.item_id - 1; // item IDs are 1-indexed, but we'll use 0-indexing for the map

        // if item hasn't been added to the itemsMap, add it
        if (!items.has(itemIndex)) {
            items.set(itemIndex, itemInfo);
        } else {
            // if it has been added, increment the quantity
            const existing = items.get(itemIndex);
            existing.quantity += row.quantity;
        }
    }

    return Array.from(items.values());
}

/**
 * Create an inventory item.
 * @param {Object} itemData - Item data.
 * @param {string} itemData.name - Item name.
 * @param {string} itemData.description - Item description.
 * @param {number} [itemData.stackSize] - Maximum stack size.
 * @param {string} [itemData.iconUrl] - Item icon URL.
 * @returns {Promise<number>}
 */
async function registerItem({ name, description, stackSize = 1, iconUrl = "" }) {
    const itemId = await dbRun("INSERT INTO item_registry (name, description, stack_size, image_url) VALUES (?, ?, ?, ?)", [
        name,
        description,
        stackSize,
        iconUrl,
    ]);
    return itemId;
}

/**
 * Get item info by id.
 * @param {number} itemId
 * @returns {Promise<Object>}
 */
async function getItemById(itemId) {
    const item = await dbGet("SELECT * FROM item_registry WHERE id = ?", [itemId]);
    if (!item) {
        throw new NotFoundError("Item not found");
    }
    return item;
}

/**
 * Get the stack size of an item with the least quantity in the user's inventory.
 * @param {number} userId - userId.
 * @param {number} itemId - itemId.
 * @returns {Promise<number>}
 */
async function getItemStackWithLeastQuantity(userId, itemId) {
    const existingItem = await dbGet("SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?", [userId, itemId]);
    if (!existingItem) {
        throw new NotFoundError("Item not found in inventory");
    }
    return existingItem;
}

/**
 * Add quantity of an item to a user inventory.
 * @param {number} userId - userId.
 * @param {Object} itemId - itemId.
 * @param {number} quantity - quantity.
 * @returns {Promise<void>}
 */
async function addItemToInventory(userId, itemId, quantity) {
    // Check if the item already exists in the user's inventory
    const existingItemStack = await getItemStackWithLeastQuantity(userId, itemId);
    const itemInfo = await dbGet("SELECT stack_size FROM item_registry WHERE id = ?", [itemId]);

    if (existingItem) {
        // If it exists, update the quantity
        const newQuantity = existingItem.quantity + quantity;

        // if quantity exceeds stack size, add new row with remaining quantity
        if (newQuantity > itemInfo.stack_size) {
            await dbRun("UPDATE inventory SET quantity = ? WHERE user_id = ? AND item_id = ?", [itemInfo.stack_size, userId, itemId]);
            await dbRun("INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, ?)", [userId, itemId, newQuantity - itemInfo.stack_size]);
        } else {
            await dbRun("UPDATE inventory SET quantity = ? WHERE user_id = ? AND item_id = ?", [newQuantity, userId, itemId]);
        }
    } else {
        // If it doesn't exist, insert a new record
        await dbRun("INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, ?)", [userId, itemId, quantity]);
    }
}

/**
 * Remove quantity of an item from a user inventory.
 * @param {number} userId - userId.
 * @param {Object} itemId - itemId.
 * @param {number} quantity - quantity.
 * @returns {Promise<void>}
 */
async function removeItemFromInventory(userId, itemId, quantity) {
    // Check if the item exists in the user's inventory
    const existingItem = await dbGet("SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?", [userId, itemId]);
    if (existingItem) {
        const newQuantity = existingItem.quantity - quantity;

        if (newQuantity > 0) {
            // If the new quantity is greater than 0, update the record
            await dbRun("UPDATE inventory SET quantity = ? WHERE user_id = ? AND item_id = ?", [newQuantity, userId, itemId]);
        } else {
            // If the new quantity is 0 or less, remove the record
            await dbRun("DELETE FROM inventory WHERE user_id = ? AND item_id = ?", [userId, itemId]);
        }
    } else {
        throw new NotFoundError("Item not found in inventory");
    }
}

module.exports = {
    getUserInventory,
    registerItem,
    getItemById,
    addItemToInventory,
    removeItemFromInventory,
};
