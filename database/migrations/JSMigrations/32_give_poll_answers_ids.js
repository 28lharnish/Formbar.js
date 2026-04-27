// 32_give_poll_answers_ids.js
// Assigns each option in poll_history.responses a stable `id` index, then adds
// responseIds to poll_answers. responseIds is JSON text holding an array of ids
// because multiselect polls can store several selected options for one student.

const { dbGetAll, dbRun } = require("@modules/database");

/**
 * @param {string|null|undefined} buttonResponse
 * @returns {string[]}
 */
function parseButtonAnswers(buttonResponse) {
    if (buttonResponse == null || buttonResponse === "") return [];
    try {
        const p = JSON.parse(buttonResponse);
        if (Array.isArray(p)) return p;
        if (typeof p === "string") return [p];
        return [];
    } catch {
        return [String(buttonResponse)].filter(Boolean);
    }
}

/**
 * @param {string|null|undefined} responsesJson
 * @returns {Array<Object>}
 */
function parsePollResponses(responsesJson) {
    try {
        const responses = JSON.parse(responsesJson);
        const arr = Array.isArray(responses) ? responses : Object.values(responses);
        return arr.map((response, index) => {
            const normalized = response && typeof response === "object" ? { ...response } : { answer: response };
            normalized.id = normalized.id ?? index;
            normalized.isCorrect = !!(normalized.isCorrect ?? normalized.correct);
            delete normalized.correct;
            return normalized;
        });
    } catch {
        return [];
    }
}

module.exports = {
    async run(database) {
        try {
            await dbRun("BEGIN TRANSACTION", [], database);

            // Check if migration has already run by checking for responseIds column in poll_answers
            const tableInfo = await dbGetAll("PRAGMA table_info(poll_answers)", [], database);
            if (tableInfo.some((col) => col.name === "responseIds")) {
                await dbRun("COMMIT", [], database);
                return;
            }

            const pollHistory = await dbGetAll("SELECT * FROM poll_history", [], database);
            const pollResponseMap = new Map();
            for (const poll of pollHistory) {
                const responses = parsePollResponses(poll.responses);
                pollResponseMap.set(poll.id, responses);
                await dbRun("UPDATE poll_history SET responses = ? WHERE id = ?", [JSON.stringify(responses), poll.id], database);
            }

            await dbRun(
                `CREATE TABLE poll_answers__new (
                    pollId INTEGER NOT NULL,
                    classId INTEGER NOT NULL,
                    userId INTEGER NOT NULL,
                    responseIds TEXT,
                    buttonResponse TEXT,
                    textResponse TEXT,
                    createdAt INTEGER,
                    PRIMARY KEY (userId, pollId)
                )`,
                [],
                database
            );

            const existingAnswers = await dbGetAll("SELECT * FROM poll_answers", [], database);
            for (const row of existingAnswers) {
                const resList = pollResponseMap.get(row.pollId) || [];
                const byAnswer = new Map(resList.map((r) => [r.answer, r.id]));

                const answers = parseButtonAnswers(row.buttonResponse);
                const ids = [];
                for (const a of answers) {
                    if (byAnswer.has(a)) ids.push(byAnswer.get(a));
                }
                const responseIds = ids.length > 0 ? JSON.stringify(ids) : null;

                await dbRun(
                    `INSERT INTO poll_answers__new (
                        pollId, classId, userId, responseIds, buttonResponse, textResponse, createdAt
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [row.pollId, row.classId, row.userId, responseIds, row.buttonResponse, row.textResponse, row.createdAt],
                    database
                );
            }

            await dbRun("DROP TABLE poll_answers", [], database);
            await dbRun("ALTER TABLE poll_answers__new RENAME TO poll_answers", [], database);

            await dbRun("COMMIT", [], database);
        } catch (err) {
            try {
                await dbRun("ROLLBACK", [], database);
            } catch {
                // Transaction may not be active
            }
            throw err;
        }
    },
};
