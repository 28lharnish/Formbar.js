# AGENTS.md

## Repository Rules

- Do not modify `database/init.sql`.
- Do not edit existing migration files.
- If schema or data behavior must change, add a new migration instead.
- Keep migration filenames in sequence with the existing migration history.
- Do not perform broad rewrites, large refactors, or destructive file operations unless explicitly requested.

## Testing Rules

- Avoid hyperspecific test files for single bug IDs when a broader suite can cover the behavior.
- Prefer consolidating coverage into the higher-level feature or endpoint suite.
- For API work, test the full endpoint or route group whenever possible.
- Use targeted regression tests only when broader coverage would be ambiguous or impractical.
- Run the narrowest relevant test suite first, then broader tests if the change touches shared behavior.
- If tests cannot be run, explain why and describe what should be verified manually.

## Code Change Rules

- Prefer fixing behavior in the shared service or controller layer instead of adding one-off patches in tests.
- When a change affects shared behavior, look for related edge cases in nearby code paths and cover them in the same feature area.
- Keep changes minimal and aligned with the existing project structure.
- Prefer using existing utilities, services, helpers, and patterns before introducing new abstractions.
- Do not add new dependencies unless they are clearly necessary and fit the existing stack.
- Follow the existing formatting, naming, and file organization conventions.
- Do not reformat unrelated files.
- Do not add decorative section-divider comments, such as long lines of dashes, box-drawing characters, or labels like `// --- Helpers ---`. Use normal comments only when they explain non-obvious behavior.
- Add JSDocs with types to functions

## Verification Preference

- When possible, verify changes against the actual running endpoint or application flow, not only unit tests.
- If a change affects persistence, confirm the on-disk database or migrated schema when practical.