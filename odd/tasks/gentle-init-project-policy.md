# gentle-init project policy

## Objective

Introduce `gentle-init` as the package-owned, workflow-neutral producer for project TDD policy so ODD and SDD consume one approved policy without requiring an SDD route.

## Problem

Project TDD/rubric production is currently coupled to `sdd-init`. ODD can consume an approved rubric, but it cannot organically create or refresh that policy without invoking an SDD-only phase. The approval UI can also omit the concise summary table and show only a candidate reference.

## Why

Policy ownership belongs to the project rather than a workflow. A neutral producer lets the parent automatically request policy creation or refresh when policy is absent, stale, unverifiable, or explicitly requested, while valid unchanged policy remains a fast path.

## Scope

- Add a package-owned `gentle-init` agent and install/discovery support.
- Add parent routing for automatic, bounded dispatch when policy creation or refresh is required.
- Keep activation and every material update behind exact human approval.
- Make `sdd-init` consume the neutral policy and retain only SDD/OpenSpec bootstrap responsibilities.
- Use `gentle-init/{project}` as the new authority; read legacy `sdd-init/{project}` only as migration input while the new topic is absent, then let the new authority win without reading or changing legacy.
- Keep `openspec/config.yaml` and `testing.rubric.active` compatible for OpenSpec-backed projects.
- Prefer an inline localized summary table before approval; allow a verified full-candidate reference plus destination/checksum as a non-blocking presentation fallback.
- Preserve manual rows and invalidate approval whenever material candidate bytes change.

## Constraints

- ODD and SDD share one canonical active policy; no duplicate policy engines.
- Tests or frameworks being present never activate TDD.
- Detection/dispatch may be automatic; activation/update may not be automatic.
- A valid unchanged policy is consumed without launching `gentle-init`.
- `sdd-init` must not launch child agents; the parent owns dispatch.
- No SDD execution is used to implement this change.
- Existing `sdd-init` Engram policy remains readable during migration.
- Existing unrelated untracked OpenSpec files in `/data/Projects/gentle-pi` are outside this worktree and untouched.

## Testing policy

- Mode: strict TDD.
- Source: `openspec/config.yaml` (`strict_tdd: true`).
- Exact full runner: `pnpm test`.
- Focused commands will use the repository's `node --experimental-strip-types --test ...` tests and the custom harness where applicable.

## Tasks

- [x] GI-001 Map current 3.1.1 agent installation, orchestrator routing, SDD init, policy persistence, and package-content tests in this worktree.
- [x] GI-002 Add failing tests for package-owned `gentle-init`, neutral dispatch/fast-path rules, legacy authority resolution, and approval presentation fallback.
  - [x] Work unit 1 package/install slice: asset requirement, delegation ownership, SDD exclusion, managed customization safety, tool boundary, authority/presentation contract, and ordinary runtime discovery.
  - [x] Work unit 2 routing slice: parent dispatch/fast-path, approval relay, shared authority resolution, and bootstrap-only SDD behavior.
- [x] GI-003 Implement the `gentle-init` agent contract and installation/discovery support.
- [x] GI-004 Implement parent policy-status resolution and automatic dispatch boundaries without implicit activation.
- [x] GI-005 Decouple `sdd-init` from policy production while preserving OpenSpec bootstrap and migration reads.
- [x] GI-006 Update package documentation and migration notes.
- [ ] GI-007 Rerun full `pnpm test` after the native review correction; record observed evidence.
- [ ] GI-008 Update the overlay in a separate work unit only after the upstream contract is stable.
- [x] GI-009 Repair the pre-existing referenced-deadline defect in RDD status resolution as a separately authorized TDD work unit, then rerun the full suite.

## Acceptance criteria

1. Installed packages expose a discoverable package-owned `gentle-init` agent.
2. The parent consumes valid unchanged policy without dispatch and dispatches `gentle-init` only for absent, stale, unverifiable, or explicitly requested policy.
3. Neither test presence nor policy detection activates or changes TDD without exact human approval.
4. The preferred approval response renders a concise table before the approval tool; table-render failure can fall back to a verified candidate reference, destination, and checksum.
5. Every material candidate revision changes its identity and requires re-presentation and new approval.
6. ODD and SDD resolve the same active policy; `sdd-init` remains bootstrap-only and never launches a child.
7. New Engram writes use `gentle-init/{project}`; legacy is read only while that key is absent and is neither compared nor changed after the new authority exists.
8. Existing OpenSpec policy remains compatible.
9. Focused tests and `pnpm test` pass.

## Checks

- Focused unit tests for agent assets, installation, routing, and policy-state resolution.
- Package-content verification for published assets.
- Runtime harness scenarios for parent fast path, dispatch path, approval-table path, link fallback, and conflict blocking.
- Full runner: `pnpm test`.

## Progress

- 2026-09-16: User approved the workflow-neutral `gentle-init` design and selected upstream `gentle-pi` ownership.
- 2026-09-16: Created dedicated worktree `feat/gentle-init-policy` from official `origin/main` at `ce47bae0` (`3.1.1`).
- 2026-09-16: Initial overlay exploration completed.
- 2026-09-17: GI-001 completed against upstream 3.1.1. `gentle-init` will be delegation-owned; routing remains an orchestrator contract rather than a duplicate TypeScript policy controller. The existing `/gentle-sdd-init` behavior that derives `strict_tdd` from detected tests must be removed or confined to approved-policy bootstrap.
- 2026-09-17: Work unit 1 completed the package/install slice of GI-002 and completed GI-003. The package now ships `gentle-init` as a delegation-owned agent, ordinary startup discovers it, SDD-only installation excludes it, forced refresh preserves customized bytes, and the agent contract keeps dispatch/approval parent-owned.
- 2026-09-17: Work unit 2 completed GI-002 routing coverage, GI-004, and GI-005. Parent prompt contracts now resolve one neutral policy for ODD and SDD, dispatch only creation/refresh states, relay exact approval without writing policy, and gate SDD bootstrap behind neutral policy resolution. `sdd-init` consumes the parent-approved locator/status and no longer generates or persists neutral policy. `/gentle-sdd-init` preserves compatible existing OpenSpec policy and reports a visible `gentle-init` route when policy is missing instead of deriving `strict_tdd` from detected tests.
- 2026-09-17: Work unit 3 completed GI-006 with a lead-with-answer README overview and progressive technical reference covering routing, approval presentation, authority migration, OpenSpec compatibility, bootstrap behavior, evidence limits, and conceptual rollback.
- 2026-09-17: Full-suite diagnosis found three candidate-caused integration regressions. The scoped correction removed a duplicated always-on policy summary, restored the established memory sentence verbatim with a separate bootstrap clarification, and mapped only the packaged `gentle-init` identity/fingerprint to the existing `worker` telemetry class.
- 2026-09-17: Separately authorized GI-009 repaired the pre-existing RDD status cancellation defect with a referenced bounded timer and deterministic cleanup coverage. GI-007 remains pending until the subsequent full-suite run.
- 2026-09-17: With the official pinned binary available, the runtime harness exposed stale `/gentle-sdd-init` expectations. Test-only corrections now exercise the WU2 neutral-policy contract for Engram, missing OpenSpec/hybrid policy, and byte-preserved existing policy; the harness is GREEN.
- 2026-09-17: Native review correction resolved `R1-unenforced-policy-approval` and `R4-legacy-migration-deadlock`; the pre-correction full-suite evidence remains recorded, but GI-007 is reopened for the corrected candidate.

## Decisions and evidence

- `gentle-init` is an automatically dispatched subagent, not a required user command.
- Inline summary table is preferred but not a hard availability gate; the complete candidate must always remain inspectable.
- `gentle-init` only authors/inspects candidate bytes; the parent binds exact human approval, publishes unchanged bytes, and independently reads them back.
- Upstream ownership was selected over overlay-created global ownership.
- The user explicitly authorized a separate work unit for the pre-existing `rdd-status-line` timeout defect after the unchanged HEAD files reproduced 7 passes and 10 cancellations and blocked the full-suite gate.

## Work unit 1 TDD evidence

Focused command:

```text
node --experimental-strip-types --test tests/package-manifest.test.ts tests/sdd-agent-tools.test.ts tests/asset-installation-runtime.test.ts
```

RED was observed before implementation. Exact failing output relevant to the new behavior was:

```text
# Subtest: gentle-init has a minimal policy-author tool boundary and parent-owned approval contract
not ok 8 - gentle-init has a minimal policy-author tool boundary and parent-owned approval contract
error: 'gentle-init.md must be a package-owned agent asset'
expected: true
actual: false
# tests 10
# pass 7
# fail 3
# duration_ms 124.817217
```

That first full run also failed before loading two suites because this fresh worktree had no installed dependencies (`ERR_MODULE_NOT_FOUND` for `@earendil-works/pi-coding-agent` and `typescript`). Dependencies were then prepared with exact command `pnpm install --frozen-lockfile --ignore-scripts`; no source or lockfile changes resulted.

After implementation, the exact GREEN summary was:

```text
1..62
# tests 62
# suites 0
# pass 62
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2216.191342
```

The focused command includes the actual SDK runtime discovery harness; its runtime subtest passed and printed the delegation/review-with-`gentle-init` to same-session SDD activation path.

## Work unit 2 TDD evidence

Focused command:

```text
node --experimental-strip-types --test tests/gentle-init-policy-contract.test.ts tests/odd-routing-contract.test.ts tests/sdd-odd-integration.test.ts tests/sdd-init.test.ts tests/sdd-preflight.test.ts
```

RED was observed before implementation. Exact failing subtest lines and summary were:

```text
not ok 1 - parent policy state matrix dispatches only creation and refresh states
not ok 2 - parent remains the interaction relay while gentle-init is the single writer
not ok 3 - new and legacy authority resolution is shared and conflict-safe
not ok 4 - sdd-init is bootstrap-only and consumes parent-resolved policy
not ok 13 - ODD resolves neutral policy without routing through SDD init
not ok 15 - gentle-sdd-init reports detected capabilities but never derives or writes TDD policy
not ok 16 - gentle-sdd-init preserves an existing OpenSpec policy byte-for-byte
not ok 18 - ODD and SDD consume one neutral policy authority
1..52
# tests 52
# suites 0
# pass 44
# fail 8
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1072.091181
```

The extension RED specifically observed `true !== false` because detection wrote `openspec/config.yaml` before neutral-policy approval.

After implementation and refactor, the exact GREEN summary was:

```text
1..52
# tests 52
# suites 0
# pass 52
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1099.904607
```

Prompt assertions prove delivered routing contracts, not autonomous model adherence. The two `tests/sdd-init.test.ts` cases execute the registered command handler and prove that detected test capability no longer writes policy, while an existing neutral OpenSpec projection remains byte-identical.

WU2 verification correction: the command previously labeled every existing config an "approved neutral policy projection" after only an existence check. Approval and revision validity are parent-owned, so the notification now says the existing neutral projection is preserved and approval must be verified by the parent. Filesystem behavior is unchanged.

Correction RED command and exact summary:

```text
node --experimental-strip-types --test tests/sdd-init.test.ts
1..2
# tests 2
# suites 0
# pass 1
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 503.373376
```

The failing subtest was `gentle-sdd-init preserves an existing OpenSpec policy byte-for-byte`; its new notification assertion evaluated false.

Correction GREEN for the same command:

```text
1..2
# tests 2
# suites 0
# pass 2
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 539.176071
```

Full WU2 focused regression after the correction:

```text
1..52
# tests 52
# suites 0
# pass 52
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1098.528219
```

Work unit 2 is approximately 480 authored additions plus deletions including its feature-document evidence. The cohesive slice exceeds the advisory target mainly because removing the obsolete detection-driven policy renderer accounts for 145 deletions and recording TDD evidence adds the required feature-document lines; splitting those from their command behavior tests and routing contract would leave an unsafe intermediate state, so no cosmetic code-golf or artificial split was used.

## Work unit 3 documentation evidence

Verification:

```text
$ node scripts/verify-package-files.mjs
gentle-pi package resource check passed (169 files; 69 exact byte-pinned contract artifacts for the v3.0.1 runtime).

$ git diff --check
<no output; exit 0>
```

Review-size impact for the two user-facing documents is 70 changed lines: 16 additions in `README.md`, plus 47 additions and 7 deletions in `docs/readme-reference.md`. The feature-document checkoff/evidence adds only this work-unit record. No source or test behavior changed in WU3.

## Full-suite regression correction evidence

Pre-edit RED:

```text
$ node --experimental-strip-types --test tests/orchestrator-budget.test.ts tests/orchestrator-rdd-ownership.test.ts
1..45
# tests 45
# suites 0
# pass 41
# fail 4
# cancelled 0
# skipped 0
# todo 0
# duration_ms 951.077697
```

The four assertions represented two correction areas: the duplicated always-on summary exceeded both core prompt budgets and the rendered RDD budget (`8267 B` short-root and `8379 B` controlled long-root), while the modified memory sentence lost the exact fixture-owned normative line.

```text
$ node --experimental-strip-types --test tests/runtime-metrics-children.test.ts
1..8
# tests 8
# suites 0
# pass 7
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 94.009748
```

The telemetry RED was `gentle-init: telemetry class`. The implementation maps only exact packaged `gentle-init` to the existing closed `worker` class; the existing package-catalog test uses the same exact alias and no schema enum changed.

Post-edit GREEN:

```text
$ node --experimental-strip-types --test tests/orchestrator-budget.test.ts tests/orchestrator-rdd-ownership.test.ts
1..45
# tests 45
# suites 0
# pass 45
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 987.052839

$ node --experimental-strip-types --test tests/runtime-metrics-children.test.ts
1..8
# tests 8
# suites 0
# pass 8
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 94.005285

$ node scripts/verify-package-files.mjs
gentle-pi package resource check passed (169 files; 69 exact byte-pinned contract artifacts for the v3.0.1 runtime).
```

The scoped code/prompt/test correction touched 20 diff lines: 14 additions and 6 deletions across `assets/orchestrator.md`, `assets/orchestrator-memory.md`, `lib/runtime-metrics-children.ts`, and the explicitly authorized `tests/runtime-metrics-children.test.ts`, before this evidence record. The orchestrator edit restores its base line, so that file has no remaining candidate diff.

Unrelated HEAD baseline remains outside this correction: candidate diff for `extensions/gentle-ai.ts` and `tests/rdd-status-line.test.ts` is exactly empty, while the isolated `rdd-status-line` test reports 7 passes and 10 cancellations. This correction neither changes nor claims to fix that baseline cancellation.

## GI-009 referenced-deadline evidence

The separately authorized work unit first reproduced the unchanged-HEAD defect:

```text
$ node --experimental-strip-types --test tests/rdd-status-line.test.ts
1..17
# tests 17
# suites 0
# pass 7
# fail 0
# cancelled 10
# skipped 0
# todo 0
# duration_ms 473.935706
```

The first cancelled test was `resolveRddModeStatus resolves to undefined within the deadline when reviewMode never settles`, with `Promise resolution is still pending but the event loop has already resolved`. A cleanup assertion was then added before production implementation and independently failed RED because no referenced deadline existed:

```text
1..18
# tests 18
# suites 0
# pass 7
# fail 1
# cancelled 10
# skipped 0
# todo 0
# duration_ms 472.497325
```

`resolveRddModeStatus` now races the fail-closed native read against a referenced `setTimeout` using the existing `RDD_STATUS_TIMEOUT_MS` bound. Its `finally` clears that timer whether the native/abort-aware read or the deadline settles first. The existing `AbortSignal.timeout` remains attached to the native request so child-process cancellation is unchanged; errors still resolve to `undefined`, and the memo read/write order and expiry calculation are unchanged.

The test instruments only the deadline-sized global timer and proves exactly one timer is created and cleared both when `reviewMode` settles first and when the never-settling stub resolves through its 150 ms abort deadline. Final focused GREEN:

```text
$ node --experimental-strip-types --test tests/rdd-status-line.test.ts
1..18
# tests 18
# suites 0
# pass 18
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 600.627714
```

GI-009 is complete. GI-007 remains unchecked until the required subsequent full `pnpm test` run.

## Runtime harness contract correction

With the official pinned native binary installed, the first harness run reached the WU2 command behavior and exposed the stale assertion exactly as follows:

```text
$ pnpm run test:harness
$ node --experimental-strip-types tests/runtime-harness.mjs
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /SDD initialized for engram:/. Input:

'SDD bootstrap inspected for engram: detected Unclassified software project; no reliable runner evidence detected; test layers: unit: 0, integration: 0, e2e: 0. Consume the parent-approved neutral policy locator; detection does not activate TDD and no policy was written.'
...
[ELIFECYCLE] Command failed with exit code 1.
```

Only `tests/runtime-harness.mjs` changed. Its four `/gentle-sdd-init` command-handler cases now verify:

- Engram creates no OpenSpec directory or config, reports bootstrap inspection and the parent-approved neutral-policy route at `info`, and omits legacy initialization/write claims.
- Hybrid and default OpenSpec with missing policy create no config or inferred `strict_tdd`; they visibly route the parent to `gentle-init`, report no policy write at `warning`, and omit legacy initialization/write claims.
- An existing config remains byte-identical, reports that approval must be verified by the parent at `info`, and still preserves the unrelated invalid-model-routing warning and customized agent bytes.

GREEN evidence:

```text
$ pnpm run test:harness
$ node --experimental-strip-types tests/runtime-harness.mjs
<no assertion output; exit 0>
```

GI-007 remains unchecked until the full `pnpm test` rerun.

## Final upstream verification evidence

After provisioning the package-local, checksum-verified Gentle AI `3.0.1` binary required by the repository harness, a fresh independent verifier ran the exact full runner and supporting checks:

```text
pnpm test
Node tests: 2673 total, 2635 passed, 0 failed, 0 cancelled, 38 skipped.
Provider contract: contract 1.2.0, 9 bundle entries, 2 generated baselines — passed.
Runtime harness: passed.

node scripts/verify-package-files.mjs
169 required files, 69 exact byte-pinned artifacts, runtime v3.0.1 — passed.

git diff --check
passed with no output.
```

The 38 skips are 34 Windows-specific checks, three installed-producer/selected-child integration checks, and one opt-in live-research check. Prompt assertions establish the shipped orchestration contract but do not prove autonomous model routing. Pre/post inventories and SHA-256 hashes for all 20 tracked and four untracked candidate paths matched exactly. This evidence predates the native review correction, so GI-007 requires a fresh full run.

## Native review correction evidence

- RED: focused contracts — 25 tests, 22 pass, 3 fail, 0 cancelled (`470.943558 ms`).
- GREEN: same suite — 25/25 pass, 0 fail/cancelled (`490.000376 ms`).
- Package verification passed: 169 files, 69 exact byte-pinned artifacts.
- `R1-unenforced-policy-approval`: resolved by read-only candidate authorship and parent checksum-bound exact publication/readback.
- `R4-legacy-migration-deadlock`: resolved by absent-only legacy migration input; existing new authority wins without legacy comparison or mutation.
- Correction lineage: `review-85271c84f6784bcc`; final correction-only snapshot is 173 diff lines (76 additions, 97 deletions), within the 180-line plan.

## Rollback boundary

For work unit 1, remove only `assets/agents/gentle-init.md`, its delegation catalog entry in `lib/sdd-preflight.ts`, its package requirement in `scripts/verify-package-files.mjs`, and the matching package/tool/runtime tests.

For work unit 2, revert only the neutral-policy sections in `assets/orchestrator.md`, `assets/orchestrator-delegation.md`, `assets/orchestrator-memory.md`, and `assets/sdd-orchestrator-workflow.md`; restore the prior `assets/agents/sdd-init.md` and `/gentle-sdd-init` policy-generation behavior in `extensions/sdd-init.ts`; and remove the WU2 contract/command tests. Do not remove or rewrite pre-existing project policies, unrelated agent configuration, or WU1 package ownership.

The feature-wide rollback additionally removes future documentation and migration notes.
