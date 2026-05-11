// 14_restructure_transactions.js
// This migration restructures the 'transactions' table to support transactions from digipog pools, to users or other pools.

const { dbGetAll, dbRun } = require("../../../modules/database");
module.exports = {
    async run(database) {
        const columns = await dbGetAll("PRAGMA table_info(transactions)", [], database);
        const fromUserColumn = columns.find((column) => column.name === "from_user");
        if (!fromUserColumn) {
            throw new Error("ALREADY_DONE");
        }

        // If the column exists, then this is a legacy transactions table.
        await dbRun("BEGIN TRANSACTION", [], database);
        try {
            // Create new temporary table
            await dbRun("DROP TABLE IF EXISTS transactions_temp", [], database);
            await dbRun(
                `CREATE TABLE transactions_temp (
                    "from_id"   INTEGER NOT NULL,
                    "to_id"     INTEGER NOT NULL,
                    "from_type" TEXT NOT NULL,
                    "to_type"   TEXT NOT NULL,
                    "amount"    INTEGER NOT NULL,
                    "reason"    TEXT NOT NULL DEFAULT 'None',
                    "date"      TEXT NOT NULL
                );`,
                [],
                database
            );

            // Migrate data in one SQLite statement instead of round-tripping once per row.
            await dbRun(
                `INSERT INTO transactions_temp (from_id, to_id, from_type, to_type, amount, reason, date)
                WITH normalized_transactions AS (
                    SELECT
                        *,
                        (from_user IS NULL OR from_user = 0) AS missing_from_user,
                        (to_user IS NULL OR to_user = 0) AS missing_to_user,
                        (from_user IS NOT NULL AND from_user != 0) AS has_from_user,
                        (to_user IS NOT NULL AND to_user != 0) AS has_to_user,
                        (pool IS NOT NULL AND pool != 0) AS has_pool
                    FROM transactions
                )
                SELECT
                    CASE
                        WHEN missing_from_user AND has_pool THEN pool
                        WHEN missing_to_user AND has_pool THEN from_user
                        WHEN has_from_user AND has_to_user THEN from_user
                        WHEN missing_from_user AND has_to_user THEN 0
                        WHEN has_from_user AND missing_to_user THEN from_user
                    END AS from_id,
                    CASE
                        WHEN missing_from_user AND has_pool THEN to_user
                        WHEN missing_to_user AND has_pool THEN pool
                        WHEN has_from_user AND has_to_user THEN to_user
                        WHEN missing_from_user AND has_to_user THEN to_user
                        WHEN has_from_user AND missing_to_user THEN 0
                    END AS to_id,
                    CASE
                        WHEN missing_from_user AND has_pool THEN 'pool'
                        WHEN missing_to_user AND has_pool THEN 'user'
                        WHEN has_from_user AND has_to_user THEN 'user'
                        WHEN missing_from_user AND has_to_user THEN 'pool'
                        WHEN has_from_user AND missing_to_user THEN 'user'
                    END AS from_type,
                    CASE
                        WHEN missing_from_user AND has_pool THEN 'user'
                        WHEN missing_to_user AND has_pool THEN 'pool'
                        WHEN has_from_user AND has_to_user THEN 'user'
                        WHEN missing_from_user AND has_to_user THEN 'user'
                        WHEN has_from_user AND missing_to_user THEN 'pool'
                    END AS to_type,
                    amount,
                    reason,
                    date
                FROM normalized_transactions;`,
                [],
                database
            );

            // Drop the old transactions table and rename the new one
            await dbRun("DROP TABLE IF EXISTS transactions", [], database);
            await dbRun("ALTER TABLE transactions_temp RENAME TO transactions", [], database);

            await dbRun("COMMIT", [], database);
        } catch (err) {
            await dbRun("ROLLBACK", [], database);
            throw err;
        }
    },
};
