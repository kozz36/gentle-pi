# Kozz theme preview tasks

## Goal

Ship the user's Kozz theme as an explicitly selectable Gentle Shell package theme and preserve the accepted renderer behaviors from issue #49 without changing user settings automatically.

## Decisions

- Base this optional layer on `feat/gentle-init-3.2-dogfood` at `28ad2d22`.
- Keep Kozz selectable through `/settings` or `--use-theme kozz`; never make it default or edit settings.
- Keep this commit out of the clean #59 contribution chain.
- Build and test only through isolated package paths.

## Tasks

- [x] KTP-001 Add and validate packaged `themes/kozz.json` without automatic selection.
- [x] KTP-002 Use `borderMuted` for the Gentle Shell prompt frame and Pi's default shell for quiet tools; update focused tests.
- [ ] KTP-003 Run focused/full package verification and native review, then commit the UI/theme work unit.
- [ ] KTP-004 Build the isolated aggregate preview, document selection/rollback, and publish only after the authorized verification gate.

## Acceptance

- `kozz` is discoverable as a package theme and is never selected automatically.
- Prompt-frame cells use `borderMuted`; unrelated theme roles remain unchanged.
- Quiet tools omit `renderShell`, inheriting Pi's default themed container.
- Focused tests, package gates, and isolated runtime smoke checks pass.
- Active HOME settings and the clean #59 chain remain untouched.

## Evidence

- Pi 0.85.1 themes docs: package `themes/` discovery and `/settings` or `--use-theme` selection.
- Pi 0.85.1 extensions docs: omitting `renderShell` uses the default themed `Box`; `renderShell: "self"` opts out.
- Source palette: `/home/kozz36/.pi/agent/themes/kozz.json` (read-only input).

## KTP-001/KTP-002 evidence

- Isolated dependency bootstrap: `pnpm install --frozen-lockfile`; lockfile and tracked dependency metadata stayed unchanged.
- Focused RED: `node --experimental-strip-types --test tests/gentle-theme.test.ts tests/gentle-shell.test.ts tests/quiet-tool-rendering.test.ts` — 94 passed, 4 intended failures (missing Kozz file, prompt frame still used `border`, quiet tools still used `renderShell: "self"`).
- Focused GREEN: the same command — 98 passed, 0 failed.
- `pnpm run typecheck` — 197 recorded diagnostics, no regressions; 2 existing file/code pairs improved.
- `git diff --check` — passed.
- `pnpm test` — 2,693 total; 2,655 passed; 0 failed; 38 skipped. Provider-contract check and runtime harness also passed in the composed script.
- Package/prepack gates and live isolated theme selection remain intentionally deferred to KTP-003/KTP-004.
