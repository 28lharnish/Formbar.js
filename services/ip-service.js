const { dbGet, dbGetAll } = require("@modules/database");

/**
 * Get configured IP access records.
 * @param {string} type - type.
 * @returns {Promise<Object>}
 */
async function getIpAccess(type) {
    const isWhitelist = type === "whitelist" ? 1 : 0;
    const ipList = await dbGetAll("SELECT id, ip FROM ip_access_list WHERE is_whitelist = ?", [isWhitelist]);
    return ipList.reduce((ips, ip) => {
        ips[ip.id] = ip;
        return ips;
    }, {});
}

/**
 * Get configured IP access records with pagination.
 * @param {string} type - type.
 * @param {number} limit - limit.
 * @param {number} offset - offset.
 * @returns {Promise<Object>}
 */
async function getIpAccessPaginated(type, limit = 20, offset = 0) {
    const isWhitelist = type === "whitelist" ? 1 : 0;
    const totalRow = await dbGet("SELECT COUNT(*) AS count FROM ip_access_list WHERE is_whitelist = ?", [isWhitelist]);
    const ips = await dbGetAll("SELECT id, ip FROM ip_access_list WHERE is_whitelist = ? ORDER BY id ASC LIMIT ? OFFSET ?", [
        isWhitelist,
        limit,
        offset,
    ]);

    return {
        ips,
        total: totalRow ? totalRow.count : 0,
    };
}

module.exports = {
    getIpAccess,
    getIpAccessPaginated,
};
