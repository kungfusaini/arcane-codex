# Arcane Codex Agent Instructions

## Theme system is source-first

- `DESIGN.md` and `src/styles/theme.css` are the canonical theme/design-system sources.
- `docs/theme-specimen.html` is a specimen/check page that must stay up to date with the canonical theme.
- Do not treat `docs/theme-specimen.html` as an independent design source or hand-maintained one-off.
- When changing website visual language, tokens, typography, spacing, navigation treatment, component states, or shared UI styles:
  1. update the central source files first (`DESIGN.md` and/or `src/styles/theme.css`),
  2. make the website consume those shared tokens/styles,
  3. update/regenerate `docs/theme-specimen.html` from the same source in the same change.
- If the specimen needs a new visual case, add it as a representation of the central system, not as separate styling that can drift.
- If a generator or sync script exists, use it. If none exists and the change would make the specimen hard to keep in sync manually, add a small generation/sync path instead of duplicating theme values.

## UI discipline

- Keep UI changes token-driven. Avoid hardcoded colours, shadows, radii, font sizes, or spacing when a theme token exists.
- Preserve interactive states: default, hover, focus-visible, active, disabled, plus loading/empty/error where relevant.
- Run the relevant checks before handoff; for CSS/UI work, run `ux_audit` when available.
