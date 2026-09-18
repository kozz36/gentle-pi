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
- [x] KTP-003 Run focused/full test verification and native review, then commit the UI/theme work unit.
- [x] KTP-004 Publish the verified experimental fork preview and document selection/rollback in issue #59.

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
- Independent verifier `01a0b3bc-8119-7680` approved the bounded candidate: 98 focused tests passed, 2,655 full-suite tests passed with 38 skips, exact theme parity held except `scrollbarTrack`, and no unrelated paths changed.
- Native review `review-aac603fafc82b385` approved and was acknowledged; its only advisory was that the local absolute source-theme path is nonportable provenance.
- UI/theme work unit committed as `df6ab2a9` (`feat(theme): add selectable Kozz preview`).
- Package gates passed: six runtime modules, 169 package files, 69 byte-pinned artifacts, and packed-package E2E with 65 installed packages.
- Disposable policy-only and aggregate packs passed their prepack suites (2,653 and 2,655 passing tests; 38 skips each). Their manifests match and neither selects a default theme; only the aggregate tarball adds `themes/kozz.json` plus the reviewed renderer/test changes.
- Installed-package PTY smoke tests proved policy-only reports `Theme not found: kozz` and falls back to dark, while aggregate accepts and shows `kozz`; Pi still displays the unavailable requested name in `/settings` after fallback.
- Preseeding isolated settings with `lastChangelogVersion: 0.85.1` kept settings bytes unchanged across all final runtime invocations (SHA-256 `abbe6f31e190fafa2e6b394f8e9bfe61046689547ba783aec898afc60d897547`). All temporary packages, caches, sessions, and transcripts were removed.
- Pure visual color distinctions and model interaction remain unverified.
- Published fork branch `feat/kozz-theme-preview` and annotated tag `v3.2.0-overlay.2-preview.1`; the tag resolves to `1b33b09507b1464060eabc0e956983159dad9656` (tag object `56fb0e1faeca0b4a3c614aeb8ed5917991288d68`).
- Posted temporary `pi -e` policy-only and aggregate testing plus rollback instructions to issue #59: https://github.com/Gentleman-Programming/gentle-shell/issues/59#issuecomment-5728352969
