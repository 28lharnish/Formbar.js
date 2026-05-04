-- 34_add_correct_poll_answer.sql
-- Adds an isCorrect flag to each poll response option without changing the table schema.

UPDATE poll_history
SET responses = (
    SELECT json_group_array(json_set(json(value), '$.isCorrect', COALESCE(json_extract(value, '$.isCorrect'), 0)))
    FROM json_each(poll_history.responses)
)
WHERE json_valid(responses);