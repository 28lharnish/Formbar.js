# AGENTS.md

## Repository Rules

- Do not modify `database/init.sql`.
- Do not edit existing migration files.
- If schema or data behavior must change, add a new migration instead.
- Keep migration filenames in sequence with the existing migration history.

## Testing Rules

- Avoid hyperspecific test files for single bug IDs when a broader suite can cover the behavior.
- Prefer consolidating coverage into the higher-level feature or endpoint suite.
- For API work, test the full endpoint or route group whenever possible.
- Use targeted regression tests only when broader coverage would be ambiguous or impractical.

## Code Change Rules

- Prefer fixing behavior in the shared service or controller layer instead of adding one-off patches in tests.
- When a change affects shared behavior, look for related edge cases in nearby code paths and cover them in the same feature area.
- Keep changes minimal and aligned with the existing project structure.

## Verification Preference

- When possible, verify changes against the actual running endpoint or application flow, not only unit tests.
- If a change affects persistence, confirm the on-disk database or migrated schema when practical.