const { dbGetAll, dbGet, dbRun } = require("@modules/database");
const { SCOPES, filterScopesByDomain, parseScopesField, TEACHER_PERMISSIONS } = require("@modules/permissions");
const { getClassIDFromCode } = require("@services/classroom-service");
const { getGlobalPermissionLevelForUser } = require("@modules/scope-resolver");
const { compare } = require("@modules/crypto");
const { rateLimit } = require("@modules/config");
const AppError = require("@errors/app-error");

// Rate limiting

const failedAttempts = new Map();

function cleanupOldAttempts() {
    const now = Date.now();
    for (const [userId, data] of failedAttempts.entries()) {
        if (data.attempts) {
            data.attempts = data.attempts.filter((attempt) => now - attempt.timestamp < rateLimit.attemptWindow);
        }
        if ((!data.attempts || data.attempts.length === 0) && (!data.lockedUntil || data.lockedUntil < now)) {
            failedAttempts.delete(userId);
        }
    }
}

const cleanupInterval = setInterval(cleanupOldAttempts, 5 * 60 * 1000);
if (typeof cleanupInterval.unref === "function") {
    cleanupInterval.unref();
}

function checkRateLimit(accountId) {
    const now = Date.now();
    const userAttempts = failedAttempts.get(accountId);

    if (!userAttempts) {
        failedAttempts.set(accountId, { attempts: [], lockedUntil: null });
        return { allowed: true };
    }

    if (userAttempts.lockedUntil && userAttempts.lockedUntil > now) {
        const waitTime = Math.ceil((userAttempts.lockedUntil - now) / 1000);
        return {
            allowed: false,
            message: `Account temporarily locked due to too many failed attempts. Try again in ${waitTime} seconds.`,
            waitTime,
        };
    }

    if (userAttempts.lockedUntil && userAttempts.lockedUntil <= now) {
        userAttempts.lockedUntil = null;
        userAttempts.attempts = [];
    }

    if (userAttempts.attempts.length > 0) {
        const lastAttempt = userAttempts.attempts[userAttempts.attempts.length - 1];
        const timeSinceLastAttempt = now - lastAttempt.timestamp;
        if (timeSinceLastAttempt < rateLimit.minDelayBetweenAttempts) {
            return {
                allowed: false,
                message: "Please wait before attempting another transfer.",
                waitTime: Math.ceil((rateLimit.minDelayBetweenAttempts - timeSinceLastAttempt) / 1000),
            };
        }
    }

    const recentAttempts = userAttempts.attempts.filter((attempt) => now - attempt.timestamp < rateLimit.attemptWindow);
    userAttempts.attempts = recentAttempts;

    const failedCount = recentAttempts.filter((attempt) => !attempt.success).length;

    if (failedCount >= rateLimit.maxAttempts) {
        userAttempts.lockedUntil = now + rateLimit.lockoutDuration;
        const waitTime = Math.ceil(rateLimit.lockoutDuration / 1000);
        return {
            allowed: false,
            message: `Too many failed attempts. Account temporarily locked for ${Math.ceil(waitTime / 60)} minutes.`,
            waitTime,
        };
    }

    return { allowed: true };
}

function recordAttempt(accountId, success) {
    const now = Date.now();
    const userAttempts = failedAttempts.get(accountId) || { attempts: [], lockedUntil: null };
    userAttempts.attempts.push({ timestamp: now, success });
    if (success) {
        userAttempts.attempts = userAttempts.attempts.filter((attempt) => attempt.success);
        userAttempts.lockedUntil = null;
    }
    failedAttempts.set(accountId, userAttempts);
}

async function getComputedGlobalUser(userId) {
    const user = await dbGet("SELECT id, email FROM users WHERE id = ?", [userId]);
    if (!user) {
        return null;
    }

    const roleRows = await dbGetAll(
        `SELECT r.id, r.name, r.scopes
         FROM user_roles ur
         JOIN roles r ON ur.roleId = r.id
         WHERE ur.userId = ? AND ur.classId IS NULL`,
        [userId]
    );

    return {
        ...user,
        roles: {
            global: roleRows.map((row) => ({
                id: row.id,
                name: row.name,
                scopes: filterScopesByDomain(row.scopes, "global"),
            })),
            class: [],
        },
    };
}

// Pool helpers

async function createPool({ name, description = "", ownerId }) {
    const poolId = await dbRun("INSERT INTO digipog_pools (name, description, amount) VALUES (?, ?, ?)", [name, description, 0]);
    await addUserToPool(poolId, ownerId, 1);
    return poolId;
}

async function deletePool(poolId) {
    await dbRun("DELETE FROM digipog_pools WHERE id = ?", [poolId]);
    await dbRun("DELETE FROM digipog_pool_users WHERE pool_id = ?", [poolId]);
}

async function getPoolsForUser(userId) {
    return dbGetAll("SELECT pool_id, owner FROM digipog_pool_users WHERE user_id = ?", [userId]);
}

async function getPoolById(poolId) {
    return dbGet("SELECT * FROM digipog_pools WHERE id = ?", [poolId]);
}

async function getPoolsForUserPaginated(userId, limit = 20, offset = 0) {
    const totalRow = await dbGet("SELECT COUNT(*) AS count FROM digipog_pool_users WHERE user_id = ?", [userId]);
    const pools = await dbGetAll("SELECT pool_id, owner FROM digipog_pool_users WHERE user_id = ? ORDER BY pool_id DESC LIMIT ? OFFSET ?", [
        userId,
        limit,
        offset,
    ]);

    return {
        pools,
        total: totalRow ? totalRow.count : 0,
    };
}

async function getUsersForPool(poolId) {
    return dbGetAll("SELECT user_id, owner FROM digipog_pool_users WHERE pool_id = ?", [poolId]);
}

async function isUserInPool(userId, poolId) {
    const row = await dbGet("SELECT 1 FROM digipog_pool_users WHERE pool_id = ? AND user_id = ? LIMIT 1", [poolId, userId]);
    return !!row;
}

/**
 * Checks whether a specific user is an owner of a pool.
 * @param {number} poolId - The pool to check.
 * @param {number} userId - The user to check.
 * @returns {Promise<boolean>} True if the user is an owner of the pool.
 */
async function isPoolOwnedByUser(poolId, userId) {
    const row = await dbGet("SELECT owner FROM digipog_pool_users WHERE pool_id = ? AND user_id = ? LIMIT 1", [poolId, userId]);
    return !!(row && row.owner);
}

/**
 * Middleware-compatible ownership check for pools.
 * @param {Object} req - Express request object
 * @returns {Promise<boolean>} Whether the requesting user owns the pool
 */
function poolOwnerCheck(req) {
    return isPoolOwnedByUser(Number(req.params.id), req.user.id);
}

async function addUserToPool(poolId, userId, ownerFlag = 0) {
    return dbRun("INSERT OR REPLACE INTO digipog_pool_users (pool_id, user_id, owner) VALUES (?, ?, ?)", [poolId, userId, ownerFlag ? 1 : 0]);
}

async function removeUserFromPool(poolId, userId) {
    if (await isPoolOwnedByUser(poolId, userId)) {
        const poolUsers = await getUsersForPool(poolId);
        const otherOwners = poolUsers.filter((poolUser) => poolUser.user_id !== userId && poolUser.owner);
        if (otherOwners.length === 0) {
            await dbRun("DELETE FROM digipog_pools WHERE id = ?", [poolId]);
            await dbRun("DELETE FROM digipog_pool_users WHERE pool_id = ?", [poolId]);
            return;
        }
    }
    await dbRun("DELETE FROM digipog_pool_users WHERE pool_id = ? AND user_id = ?", [poolId, userId]);
}

async function setUserOwnerFlag(poolId, userId, ownerFlag) {
    return dbRun("UPDATE digipog_pool_users SET owner = ? WHERE pool_id = ? AND user_id = ?", [ownerFlag ? 1 : 0, poolId, userId]);
}

async function addMemberToPool({ actingUserId, poolId, userId }) {
    if (!Number.isInteger(poolId) || poolId < 0) {
        return { success: false, message: "Invalid pool ID." };
    }

    if (!Number.isInteger(userId) || userId <= 0) {
        return { success: false, message: "Invalid user ID." };
    }

    const isOwner = await isPoolOwnedByUser(poolId, actingUserId);
    if (!isOwner) {
        return { success: false, message: "You do not own this pool." };
    }

    const userToAdd = await dbGet("SELECT * FROM users WHERE id = ?", [userId]);
    if (!userToAdd) {
        return { success: false, message: "User not found." };
    }

    const isInPool = await isUserInPool(userId, poolId);
    if (isInPool) {
        return { success: false, message: "User is already a member of this pool." };
    }

    await addUserToPool(poolId, userId, 0);

    return { success: true, message: "User added to pool successfully." };
}

async function removeMemberFromPool({ actingUserId, poolId, userId }) {
    if (!Number.isInteger(poolId) || poolId < 0) {
        return { success: false, message: "Invalid pool ID." };
    }

    if (!Number.isInteger(userId) || userId <= 0) {
        return { success: false, message: "Invalid user ID." };
    }

    const isOwner = await isPoolOwnedByUser(poolId, actingUserId);
    if (!isOwner) {
        return { success: false, message: "You do not own this pool." };
    }

    const isInPool = await isUserInPool(userId, poolId);
    if (!isInPool) {
        return { success: false, message: "User is not a member of this pool." };
    }

    await removeUserFromPool(poolId, userId);

    return { success: true, message: "User removed from pool successfully." };
}

async function payoutPool({ actingUserId, poolId }) {
    if (!Number.isInteger(poolId) || poolId < 0) {
        return { success: false, message: "Invalid pool ID." };
    }

    const isOwner = await isPoolOwnedByUser(poolId, actingUserId);
    if (!isOwner) {
        return { success: false, message: "You do not own this pool." };
    }

    const pool = await getPoolById(poolId);
    if (!pool) {
        return { success: false, message: "Pool not found." };
    }

    const members = await getUsersForPool(poolId);
    if (members.length === 0) {
        return { success: false, message: "Pool has no members." };
    }

    const amountPerMember = Math.floor(pool.amount / members.length);

    // Payout each member
    try {
        await dbRun("BEGIN TRANSACTION");
        for (const member of members) {
            const user = await dbGet("SELECT * FROM users WHERE id = ?", [member.user_id]);
            if (!user) continue;

            await dbRun("UPDATE users SET digipogs = digipogs + ? WHERE id = ?", [amountPerMember, member.user_id]);
            await dbRun("INSERT INTO transactions (from_id, to_id, from_type, to_type, amount, reason, date) VALUES (?, ?, ?, ?, ?, ?, ?)", [
                pool.id,
                member.user_id,
                "pool",
                "user",
                amountPerMember,
                "Pool Payout",
                Date.now(),
            ]);
        }

        await dbRun("UPDATE digipog_pools SET amount = 0 WHERE id = ?", [poolId]);
        await dbRun("COMMIT");
    } catch (err) {
        await dbRun("ROLLBACK");
        throw AppError("An error occurred while processing the pool payout.", { event: "digipog_pool_payout_error", error: err.message });
    }

    return { success: true, message: "Pool payout successful." };
}

// Transactions

async function getUserTransactions(userId) {
    const transactions = await dbGetAll(
        "SELECT * FROM transactions WHERE (from_id = ? AND from_type = 'user') OR (to_id = ? AND to_type = 'user') ORDER BY date DESC",
        [userId, userId]
    );
    return enrichTransactions(transactions);
}

async function getUserTransactionsPaginated(userId, limit = 25, offset = 0) {
    let whereQuery = "WHERE (from_id = ? AND from_type = 'user') OR (to_id = ? AND to_type = 'user')";
    const params = [userId, userId];

    const totalRow = await dbGet(`SELECT COUNT(*) AS count FROM transactions ${whereQuery}`, params);
    const transactions = await dbGetAll(`SELECT * FROM transactions ${whereQuery} ORDER BY date DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const enrichedTransactions = await enrichTransactions(transactions);

    return {
        transactions: enrichedTransactions,
        total: totalRow ? totalRow.count : 0,
    };
}

async function enrichTransactions(transactions) {
    if (!transactions || transactions.length === 0) {
        return [];
    }

    const userIds = new Set();
    const poolIds = new Set();
    const classIds = new Set();

    for (const transaction of transactions) {
        if (transaction.from_id != null) {
            if (transaction.from_type === "user" || transaction.from_type === "award") {
                userIds.add(transaction.from_id);
            } else if (transaction.from_type === "pool") {
                poolIds.add(transaction.from_id);
            } else if (transaction.from_type === "class") {
                classIds.add(transaction.from_id);
            }
        }

        if (transaction.to_id != null) {
            if (transaction.to_type === "user" || transaction.to_type === "award") {
                userIds.add(transaction.to_id);
            } else if (transaction.to_type === "pool") {
                poolIds.add(transaction.to_id);
            } else if (transaction.to_type === "class") {
                classIds.add(transaction.to_id);
            }
        }
    }

    const [users, pools, classes] = await Promise.all([
        fetchUsersByIds(Array.from(userIds)),
        fetchPoolsByIds(Array.from(poolIds)),
        fetchClassesByIds(Array.from(classIds)),
    ]);

    return transactions.map((transaction) => ({
        amount: transaction.amount,
        reason: transaction.reason,
        date: transaction.date,
        from: buildTransactionParty(transaction.from_id, transaction.from_type, users, pools, classes),
        to: buildTransactionParty(transaction.to_id, transaction.to_type, users, pools, classes),
    }));
}

async function fetchUsersByIds(userIds) {
    if (userIds.length === 0) return new Map();

    const placeholders = userIds.map(() => "?").join(",");
    const users = await dbGetAll(`SELECT id, displayName, email FROM users WHERE id IN (${placeholders})`, userIds);

    const userMap = new Map();
    for (const user of users) {
        userMap.set(user.id, {
            id: user.id,
            username: user.displayName || user.email || "Unknown User",
        });
    }
    return userMap;
}

async function fetchPoolsByIds(poolIds) {
    if (poolIds.length === 0) return new Map();

    const placeholders = poolIds.map(() => "?").join(",");
    const pools = await dbGetAll(`SELECT id, name FROM digipog_pools WHERE id IN (${placeholders})`, poolIds);

    const poolMap = new Map();
    for (const pool of pools) {
        poolMap.set(pool.id, {
            id: pool.id,
            username: pool.name || "Unknown Pool",
        });
    }
    return poolMap;
}

async function fetchClassesByIds(classIds) {
    if (classIds.length === 0) return new Map();

    const placeholders = classIds.map(() => "?").join(",");
    const classes = await dbGetAll(`SELECT id, name FROM classroom WHERE id IN (${placeholders})`, classIds);

    const classMap = new Map();
    for (const classInfo of classes) {
        classMap.set(classInfo.id, {
            id: classInfo.id,
            username: classInfo.name || "Unknown Class",
        });
    }
    return classMap;
}

function buildTransactionParty(id, type, users, pools, classes) {
    const normalizedType = type || "unknown";
    let username = null;

    if (normalizedType === "user" || normalizedType === "award") {
        username = users.get(id)?.username || "Unknown User";
    } else if (normalizedType === "pool") {
        username = pools.get(id)?.username || "Unknown Pool";
    } else if (normalizedType === "class") {
        username = classes.get(id)?.username || "Unknown Class";
    }

    return {
        id,
        type: normalizedType,
        username,
    };
}

// Award / Transfer

const AWARD_RECIPIENT_TYPES = new Set(["user", "pool", "class"]);

function normalizeAwardRecipient(awardData) {
    let to = awardData?.to;
    let deprecatedFormatUsed = false;

    if (typeof to === "string" || typeof to === "number") {
        to = { id: to, type: "user" };
        deprecatedFormatUsed = true;
    } else if (!to && (awardData?.userId || awardData?.studentId)) {
        to = { id: awardData.userId || awardData.studentId, type: "user" };
        deprecatedFormatUsed = true;
    }

    if (!to || typeof to !== "object") {
        return { error: "Missing recipient identifier." };
    }

    const normalizedRecipient = { ...to };
    if (!normalizedRecipient.id && (normalizedRecipient.userId || normalizedRecipient.studentId)) {
        normalizedRecipient.id = normalizedRecipient.userId || normalizedRecipient.studentId;
        if (!normalizedRecipient.type) {
            normalizedRecipient.type = "user";
        }
        deprecatedFormatUsed = true;
    }

    if (!normalizedRecipient.type) {
        normalizedRecipient.type = "user";
        deprecatedFormatUsed = true;
    }

    return { to: normalizedRecipient, deprecatedFormatUsed };
}

function validateAwardRequest({ from, to, amount }) {
    if (!from || Number.isNaN(amount)) {
        return "Missing required fields.";
    }

    if (!AWARD_RECIPIENT_TYPES.has(to.type)) {
        return "Invalid recipient type.";
    }

    if (amount <= 0) {
        return "Amount must be greater than zero.";
    }

    if (to.type !== "class" && !to.id) {
        return "Missing recipient identifier.";
    }

    return null;
}

function hasClassDigipogAwardAuthority(scopes) {
    return scopes.includes(SCOPES.CLASS.SYSTEM.ADMIN) || scopes.includes(SCOPES.CLASS.DIGIPOGS.AWARD);
}

async function userCanAwardDigipogsInClass(userId, classId, ownerId) {
    if (ownerId === userId) {
        return true;
    }

    const roleRows = await dbGetAll(
        `SELECT r.scopes FROM user_roles ur
         JOIN roles r ON ur.roleId = r.id
         WHERE ur.userId = ? AND ur.classId = ?`,
        [userId, classId]
    );

    return hasClassDigipogAwardAuthority(roleRows.flatMap((row) => parseScopesField(row.scopes)));
}

async function getAwardableClassIdsForUser(userId) {
    const senderRoleRows = await dbGetAll(
        `SELECT ur.classId, r.scopes
         FROM user_roles ur
         JOIN roles r ON ur.roleId = r.id
         WHERE ur.userId = ? AND ur.classId IS NOT NULL`,
        [userId]
    );

    const senderClassScopes = new Map();
    for (const row of senderRoleRows) {
        const scopes = parseScopesField(row.scopes);
        const existingScopes = senderClassScopes.get(row.classId) || [];
        senderClassScopes.set(row.classId, existingScopes.concat(scopes));
    }

    return [...senderClassScopes.entries()].filter(([, scopes]) => hasClassDigipogAwardAuthority(scopes)).map(([classId]) => classId);
}

async function userIsInAnyClass(userId, classIds) {
    if (classIds.length === 0) {
        return false;
    }

    const placeholders = classIds.map(() => "?").join(",");
    const row = await dbGet(`SELECT 1 FROM classusers WHERE studentId = ? AND classId IN (${placeholders}) LIMIT 1`, [userId, ...classIds]);
    return Boolean(row);
}

async function userIsInClassOwnedByUser(userId, ownerId) {
    const row = await dbGet(
        `SELECT 1 FROM classusers cu1
         INNER JOIN classroom c ON c.id = cu1.classId
         WHERE cu1.studentId = ?
         AND c.owner = ?
         LIMIT 1`,
        [userId, ownerId]
    );

    return Boolean(row);
}

async function canAwardUserByClassAuthority(senderId, recipientId) {
    const awardableClassIds = await getAwardableClassIdsForUser(senderId);
    if (await userIsInAnyClass(recipientId, awardableClassIds)) {
        return true;
    }

    return userIsInClassOwnedByUser(recipientId, senderId);
}

async function awardDigipogsToClass({ from, to, amount, senderPermissionLevel, fail }) {
    if (to.code) {
        to.id = await getClassIDFromCode(to.code);
        if (!to.id) {
            return fail("Invalid class code.");
        }
    } else if (!to.id) {
        return fail("Missing class identifier.");
    }

    const classInfo = await dbGet("SELECT c.id, c.owner FROM classroom c WHERE c.id = ?", [to.id]);
    if (!classInfo) {
        return fail("Recipient class not found.");
    }

    const canAwardTargetClass = await userCanAwardDigipogsInClass(from, to.id, classInfo.owner);
    if (!canAwardTargetClass && senderPermissionLevel < TEACHER_PERMISSIONS) {
        return fail("Sender does not have permission to award to this class.");
    }

    await dbRun("UPDATE users SET digipogs = digipogs + ? WHERE id IN (SELECT studentId FROM classusers WHERE classId = ?) OR id = ?", [
        amount,
        to.id,
        classInfo.owner,
    ]);

    return null;
}

async function awardDigipogsToPool({ to, amount, senderPermissionLevel, fail }) {
    if (!to.id) {
        return fail("Missing pool identifier.");
    }

    if (senderPermissionLevel < TEACHER_PERMISSIONS) {
        return fail("Sender does not have permission to award to pools.");
    }

    const poolInfo = await dbGet("SELECT * FROM digipog_pools WHERE id = ?", [to.id]);
    if (!poolInfo) {
        return fail("Recipient pool not found.");
    }

    await dbRun("UPDATE digipog_pools SET amount = amount + ? WHERE id = ?", [amount, to.id]);

    return null;
}

async function awardDigipogsToUser({ from, to, amount, senderPermissionLevel, fail }) {
    const toUser = await dbGet("SELECT id FROM users WHERE id = ?", [to.id]);
    if (!toUser) {
        return fail("Recipient account not found.");
    }

    if (senderPermissionLevel < TEACHER_PERMISSIONS) {
        const hasPermission = await canAwardUserByClassAuthority(from, to.id);
        if (!hasPermission) {
            return fail("Sender does not have permission to award to this user.");
        }
    }

    await dbRun("UPDATE users SET digipogs = digipogs + ? WHERE id = ?", [amount, to.id]);

    return null;
}

async function applyAwardDigipogs({ from, to, amount, senderPermissionLevel, fail }) {
    if (to.type === "class") {
        return awardDigipogsToClass({ from, to, amount, senderPermissionLevel, fail });
    }

    if (to.type === "pool") {
        return awardDigipogsToPool({ to, amount, senderPermissionLevel, fail });
    }

    return awardDigipogsToUser({ from, to, amount, senderPermissionLevel, fail });
}

function buildAwardSuccessMessage(deprecatedFormatUsed) {
    return deprecatedFormatUsed
        ? "Digipogs awarded successfully. Warning: Deprecated award format used. See documentation for updated usage."
        : "Digipogs awarded successfully.";
}

async function awardDigipogs(awardData, user) {
    try {
        const from = user?.userId ?? user?.id;
        const amount = Math.ceil(Number(awardData?.amount));
        const reason = awardData?.reason || "Awarded";

        const normalizedRecipient = normalizeAwardRecipient(awardData);
        if (normalizedRecipient.error) {
            return { success: false, message: normalizedRecipient.error };
        }

        const { to, deprecatedFormatUsed } = normalizedRecipient;
        const validationError = validateAwardRequest({ from, to, amount });
        if (validationError) {
            return { success: false, message: validationError };
        }

        const accountId = `award-${from}`;
        const fail = (message) => {
            recordAttempt(accountId, false);
            return { success: false, message };
        };

        const rateLimitCheck = checkRateLimit(accountId);
        if (!rateLimitCheck.allowed) {
            return { success: false, message: rateLimitCheck.message, rateLimited: true, waitTime: rateLimitCheck.waitTime };
        }

        const fromUser = await getComputedGlobalUser(from);
        if (!fromUser || !fromUser.email) {
            return fail("Sender account not found.");
        }
        const senderPermissionLevel = getGlobalPermissionLevelForUser(fromUser);

        const awardFailure = await applyAwardDigipogs({ from, to, amount, senderPermissionLevel, fail });
        if (awardFailure) {
            return awardFailure;
        }

        try {
            await dbRun("INSERT INTO transactions (from_id, to_id, from_type, to_type, amount, reason, date) VALUES (?, ?, ?, ?, ?, ?, ?)", [
                from,
                to.id,
                "award",
                to.type,
                amount,
                reason,
                Date.now(),
            ]);
        } catch (err) {
            return { success: true, message: "Award succeeded, but failed to log transaction." };
        }

        recordAttempt(accountId, true);
        return {
            success: true,
            message: buildAwardSuccessMessage(deprecatedFormatUsed),
        };
    } catch (err) {
        return { success: false, message: "Database error." };
    }
}

async function transferDigipogs(transferData) {
    try {
        const { pin, reason = "", pool } = transferData;
        let from = transferData.from;
        let to = transferData.to;
        const amount = Math.floor(transferData.amount);

        let deprecatedFormatUsed = false;
        if (typeof from === "string" || typeof from === "number") {
            // Old API: `from`/`to` were plain user IDs; `pool` flag indicated a pool recipient
            if (typeof to !== "string" && typeof to !== "number") {
                return { success: false, message: "Missing recipient identifier." };
            }
            from = { id: from, type: "user" };
            to = { id: pool ? pool : to, type: pool ? "pool" : "user" };
            deprecatedFormatUsed = true;
        } else if (!from || !from.id) {
            return { success: false, message: "Missing sender identifier." };
        }
        if (!from.type) from.type = "user";
        // Normalize `to` independently: if it's still a primitive at this point
        // (e.g. the caller passed an object `from` but a raw id for `to`), wrap it
        // rather than letting `to.type` throw on a non-object.
        if (typeof to === "string" || typeof to === "number") {
            to = { id: to, type: pool ? "pool" : "user" };
        } else if (!to || typeof to !== "object") {
            return { success: false, message: "Missing recipient identifier." };
        }
        if (!to.type) to.type = "user";

        if (!from || !from.id || !to || !to.id || !amount || reason === undefined || !pin) {
            return { success: false, message: "Missing required fields." };
        } else if (amount <= 0) {
            return { success: false, message: "Amount must be greater than zero." };
        } else if (from.type === to.type && from.id === to.id) {
            return { success: false, message: "Cannot transfer to the same account." };
        } else if ((from.type !== "user" && from.type !== "pool") || (to.type !== "user" && to.type !== "pool")) {
            return { success: false, message: "Invalid sender or recipient type." };
        }

        const accountId = `${from.type}-${from.id}`;
        const rateLimitCheck = checkRateLimit(accountId);
        if (!rateLimitCheck.allowed) {
            return { success: false, message: rateLimitCheck.message, rateLimited: true, waitTime: rateLimitCheck.waitTime };
        }

        let fromAccount;
        if (from.type === "user") {
            fromAccount = await dbGet("SELECT * FROM users WHERE id = ?", [from.id]);
            if (!fromAccount) {
                recordAttempt(accountId, false);
                return { success: false, message: "Sender account not found." };
            }
        } else {
            fromAccount = await dbGet("SELECT * FROM digipog_pools WHERE id = ?", [from.id]);
            const poolUser = await dbGet("SELECT user_id FROM digipog_pool_users WHERE pool_id = ? AND owner = 1", [from.id]);
            if (!fromAccount) {
                recordAttempt(accountId, false);
                return { success: false, message: "Sender pool not found." };
            }
            const poolOwner = await dbGet("SELECT pin FROM users WHERE id = ?", [poolUser.user_id]);
            fromAccount.pin = poolOwner.pin;
        }

        if (!fromAccount.pin) {
            recordAttempt(accountId, false);
            return { success: false, message: "Account PIN not configured." };
        }

        const isPinValid = await compare(String(pin), fromAccount.pin);
        if (!isPinValid) {
            recordAttempt(accountId, false);
            return { success: false, message: "Invalid PIN." };
        }

        const fromBalance = from.type === "user" ? fromAccount.digipogs : fromAccount.amount;
        if (fromBalance < amount) {
            recordAttempt(accountId, false);
            return { success: false, message: "Insufficient funds." };
        }

        const taxedAmount = Math.floor(amount * 0.9) > 1 ? Math.floor(amount * 0.9) : 1;
        const taxAmount = amount - taxedAmount;

        let toAccount;
        if (to.type === "user") {
            toAccount = await dbGet("SELECT * FROM users WHERE id = ?", [to.id]);
            if (!toAccount) {
                recordAttempt(accountId, false);
                return { success: false, message: "Recipient account not found." };
            }
        } else {
            toAccount = await dbGet("SELECT * FROM digipog_pools WHERE id = ?", [to.id]);
            if (!toAccount) {
                recordAttempt(accountId, false);
                return { success: false, message: "Recipient pool not found." };
            }
        }

        try {
            await dbRun("BEGIN TRANSACTION");
            if (from.type === "user") {
                await dbRun("UPDATE users SET digipogs = digipogs - ? WHERE id = ?", [amount, from.id]);
            } else {
                await dbRun("UPDATE digipog_pools SET amount = amount - ? WHERE id = ?", [amount, from.id]);
            }
            if (to.type === "user") {
                await dbRun("UPDATE users SET digipogs = digipogs + ? WHERE id = ?", [taxedAmount, to.id]);
            } else {
                await dbRun("UPDATE digipog_pools SET amount = amount + ? WHERE id = ?", [taxedAmount, to.id]);
            }
            const devPool = await dbGet("SELECT * FROM digipog_pools WHERE id = ?", [0]);
            if (devPool) await dbRun("UPDATE digipog_pools SET amount = amount + ? WHERE id = ?", [taxAmount, 0]);
            await dbRun("COMMIT");
        } catch (err) {
            try {
                await dbRun("ROLLBACK");
            } catch (rollbackErr) {}
            recordAttempt(accountId, false);
            return { success: false, message: "Transfer failed due to database error." };
        }

        try {
            await dbRun("INSERT INTO transactions (from_id, from_type, to_id, to_type, amount, reason, date) VALUES (?, ?, ?, ?, ?, ?, ?)", [
                from.id,
                from.type,
                to.id,
                to.type,
                amount,
                reason,
                Date.now(),
            ]);
        } catch (err) {}

        recordAttempt(accountId, true);
        return {
            success: true,
            message: `Transfer successful. ${deprecatedFormatUsed ? "Warning: Deprecated transfer format used. See documentation for updated usage." : ""}`,
        };
    } catch (err) {
        return { success: false, message: "Database error." };
    }
}

module.exports = {
    // Transactions
    getUserTransactions,
    getUserTransactionsPaginated,
    awardDigipogs,
    transferDigipogs,

    // Pool helpers
    createPool,
    deletePool,
    getPoolsForUser,
    getPoolsForUserPaginated,
    getUsersForPool,
    getPoolById,
    isUserInPool,
    isPoolOwnedByUser,
    poolOwnerCheck,
    addUserToPool,
    removeUserFromPool,
    setUserOwnerFlag,
    addMemberToPool,
    removeMemberFromPool,
    payoutPool,
};
