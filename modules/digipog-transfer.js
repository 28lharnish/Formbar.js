/**
 * Read the sender identifier from the supported digipog transfer request fields.
 * @param {Object} body - Request body.
 * @returns {unknown}
 */
function getTransferFromValue(body) {
    return body?.from ?? body?.fromUserId ?? body?.userId;
}

/**
 * Normalize a digipog transfer sender reference into a stable shape.
 * @param {unknown} rawFrom - Raw sender reference.
 * @returns {{id: number, type: "user"|"pool"}|null}
 */
function normalizeTransferFrom(rawFrom) {
    if (rawFrom === undefined || rawFrom === null || rawFrom === "") {
        return null;
    }

    if (typeof rawFrom === "object") {
        const type = rawFrom.type || "user";
        const id = Number(rawFrom.id ?? rawFrom.userId ?? rawFrom.poolId);
        if (!Number.isInteger(id) || id <= 0 || !["user", "pool"].includes(type)) {
            return null;
        }
        return { id, type };
    }

    const id = Number(rawFrom);
    if (!Number.isInteger(id) || id <= 0) {
        return null;
    }

    return { id, type: "user" };
}

module.exports = {
    getTransferFromValue,
    normalizeTransferFrom,
};
