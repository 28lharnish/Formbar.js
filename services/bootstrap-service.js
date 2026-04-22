const { dbGet, dbRun } = require("@modules/database");

/**
 * * Ensure the built-in developer pool exists.
 * @returns {Promise<void>}
 */
async function ensureFormbarDeveloperPool() {
    const formbarDevPool = await dbGet("SELECT * FROM digipog_pools WHERE id = 0");
    if (formbarDevPool) {
        return;
    }

    await dbRun("INSERT INTO digipog_pools (id, name, description, amount) VALUES (?, ?, ?, ?)", [
        0,
        "Formbar Developer Pool",
        "Formbar Developer pog pool. Accumulates from the 10% tax on digipog transactions.",
        0,
    ]);
    await dbRun("INSERT INTO digipog_pool_users (pool_id, user_id, owner) VALUES (?, ?, ?)", [0, 1, 1]);
}

module.exports = {
    ensureFormbarDeveloperPool,
};
