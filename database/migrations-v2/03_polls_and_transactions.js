const { all, columns, mark, rebuild, run } = require("./00_helpers");

/**
 * Converts legacy poll and transaction representations.
 *
 * @param {import("sqlite3").Database} database
 * @returns {Promise<void>}
 */
async function runMigration(database) {
    const applied = await all(database, "SELECT 1 FROM schema_migrations_v2 WHERE name = ?", ["03_polls_and_transactions"]);
    if (applied.length) return;
    await run(database, "BEGIN IMMEDIATE");
    try {
        const customPollColumns = await columns(database, "custom_polls");
        const promptMD = customPollColumns.includes("promptMD") ? "promptMD" : "prompt";
        const promptHTML = customPollColumns.includes("promptHTML") ? "promptHTML" : "prompt";
        const allowVoteChanges = customPollColumns.includes("allowVoteChanges") ? "allowVoteChanges" : "1";
        const allowMultipleResponses = customPollColumns.includes("allowMultipleResponses") ? "allowMultipleResponses" : "0";
        await rebuild(
            database,
            "custom_polls",
            `CREATE TABLE custom_polls__migration (
                id INTEGER NOT NULL UNIQUE,
                owner TEXT,
                name TEXT,
                prompt TEXT,
                promptMD TEXT,
                promptHTML TEXT,
                answers TEXT NOT NULL,
                textRes INTEGER NOT NULL DEFAULT 0 CHECK (textRes IN (0, 1)),
                blind INTEGER NOT NULL DEFAULT 0 CHECK (blind IN (0, 1)),
                allowVoteChanges INTEGER NOT NULL DEFAULT 1 CHECK (allowVoteChanges IN (0, 1)),
                allowMultipleResponses INTEGER NOT NULL DEFAULT 0 CHECK (allowMultipleResponses IN (0, 1)),
                weight INTEGER NOT NULL DEFAULT 1,
                public INTEGER NOT NULL DEFAULT 0 CHECK (public IN (0, 1)),
                PRIMARY KEY (id AUTOINCREMENT)
            )`,
            `INSERT INTO custom_polls__migration
                (id, owner, name, prompt, promptMD, promptHTML, answers, textRes, blind,
                 allowVoteChanges, allowMultipleResponses, weight, public)
             SELECT id, owner, name, prompt, ${promptMD}, ${promptHTML}, answers, textRes, blind,
                    ${allowVoteChanges}, ${allowMultipleResponses}, weight, public
             FROM custom_polls__migration_source`
        );

        const history = await all(database, "SELECT id, class, data, date FROM poll_history");
        await rebuild(
            database,
            "poll_history",
            `CREATE TABLE poll_history__migration (
                id INTEGER NOT NULL UNIQUE,
                class INTEGER NOT NULL,
                prompt TEXT,
                responses TEXT,
                allowMultipleResponses INTEGER NOT NULL DEFAULT 0,
                blind INTEGER NOT NULL DEFAULT 0,
                allowTextResponses INTEGER NOT NULL DEFAULT 0,
                createdAt INTEGER NOT NULL,
                auto_end_timer INTEGER,
                auto_end_threshold INTEGER,
                blind_until_ended INTEGER NOT NULL DEFAULT 0 CHECK (blind_until_ended IN (0, 1)),
                promptMD TEXT,
                promptHTML TEXT,
                PRIMARY KEY (id AUTOINCREMENT)
            )`,
            "INSERT INTO poll_history__migration (id, class, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            history.map((row) => {
                let data = {};
                try {
                    data = JSON.parse(row.data || "{}");
                } catch {
                    data = {};
                }
                const createdAt = Date.parse(`${row.date || ""}T00:00:00.000Z`);
                return [
                    row.id,
                    row.class,
                    data.prompt || null,
                    data.responses ? JSON.stringify(data.responses) : null,
                    data.allowMultipleResponses ? 1 : 0,
                    data.blind ? 1 : 0,
                    data.allowTextResponses ? 1 : 0,
                    Number.isNaN(createdAt) ? 0 : createdAt,
                ];
            })
        );

        const answerColumns = await columns(database, "poll_answers");
        const answers = await all(
            database,
            `SELECT pollId, userId, buttonResponse, textResponse${answerColumns.includes("classId") ? ", classId" : ""} FROM poll_answers`
        );
        await rebuild(
            database,
            "poll_answers",
            `CREATE TABLE poll_answers__migration (
                pollId INTEGER NOT NULL,
                classId INTEGER NOT NULL,
                userId INTEGER NOT NULL,
                responseIds TEXT,
                buttonResponse TEXT,
                textResponse TEXT,
                createdAt INTEGER,
                PRIMARY KEY (userId, pollId)
            )`,
            "INSERT OR IGNORE INTO poll_answers__migration (pollId, classId, userId, buttonResponse, textResponse) VALUES (?, COALESCE((SELECT class FROM poll_history WHERE id = ?), 0), ?, ?, ?)",
            answers.map((row) => [row.pollId, row.pollId, row.userId, row.buttonResponse, row.textResponse])
        );

        const transactionColumns = await columns(database, "transactions");
        const transactions = await all(
            database,
            transactionColumns.includes("from_user")
                ? "SELECT from_user, to_user, pool, amount, reason, date FROM transactions"
                : 'SELECT "from" AS from_user, "to" AS to_user, NULL AS pool, digipogs AS amount, reason, date FROM transactions'
        );
        await rebuild(
            database,
            "transactions",
            `CREATE TABLE transactions__migration (
                from_id INTEGER NOT NULL,
                to_id INTEGER NOT NULL,
                from_type TEXT NOT NULL,
                to_type TEXT NOT NULL,
                amount INTEGER NOT NULL,
                reason TEXT NOT NULL DEFAULT 'None',
                date TEXT NOT NULL
            )`,
            "INSERT INTO transactions__migration (from_id, to_id, from_type, to_type, amount, reason, date) VALUES (?, ?, ?, ?, ?, ?, ?)",
            transactions.map((row) => {
                const fromUser = row.from_user || 0;
                const toUser = row.to_user || 0;
                const pool = row.pool || 0;
                if (!fromUser && pool) return [pool, toUser, "pool", "user", row.amount, row.reason, row.date];
                if (!toUser && pool) return [fromUser, pool, "user", "pool", row.amount, row.reason, row.date];
                return [fromUser, toUser, "user", "user", row.amount, row.reason, row.date];
            })
        );

        await mark(database, "03_polls_and_transactions");
        await run(database, "COMMIT");
    } catch (error) {
        await run(database, "ROLLBACK").catch(() => undefined);
        throw error;
    }
}

module.exports = { run: runMigration };
