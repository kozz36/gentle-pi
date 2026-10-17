# Task-scoped optional TDD v3 rubric

Read this reference only when the ODD parent explicitly invokes `gentle_tdd_rubric` for genuinely unresolved task test applicability/classification or a requested task-scoped mode. Ordinary Shell 4.3 work retains its applicable test-first default. This reference supplies no automatic classifier or mode choice; reading it does not activate a mode.

## Classify the effect first

Classify by effect, not by file extension, filename, or the existence of tests. Ask whether the change has a clear expected outcome, an applicable runnable deterministic check, and a meaningful pre-implementation failure.

| Change effect | Proportionate path |
| --- | --- |
| Observable behavior, including executable configuration or prompt routing/behavior | Test-first when the expected outcome and runnable deterministic check are clear. Markdown can change behavior. |
| Passive documentation or presentation with no executable behavior contract | Ordinary structural/content checks; explain why there is no meaningful RED. Do not manufacture a failure. |
| Mixed behavioral and passive changes | Separate the effects; test the behavioral contract and check the passive portion. |
| Unavailable runner or unclear expected outcome | Report the exact limitation or unresolved decision. Do not call a loader failure behavioral RED or claim unobserved evidence. |

An applicable test must exercise the changed contract, not merely exist nearby. Preserve applicable runnable tests and required validation under every mode. When applicability remains unresolved, state the concrete uncertainty to the human instead of guessing.

## Human choice before a special mode

For unresolved applicability or a requested special mode, establish an explicit human choice covering the task, scope, and mode before proceeding. An unambiguous human task-specific request already counts as that choice; do not demand a redundant UI confirmation. If any part is ambiguous, use existing `ask_user_choice` with closed, concrete task/scope/mode options, including retaining the default or declining. Explain the effect-based evidence and tradeoff so the human can choose; never infer consent from file type, test presence, or a prior task.

Record the reason and provenance in the ordinary task report: the chosen task/scope/mode, applicability evidence, and the human request or choice response that authorized it. A human choice authorizes consideration of a mode, not bypassing its eligibility or evidence requirements.

On cancellation, headless execution, or unavailable interaction, apply no special mode. Continue under the default only when the task can safely proceed without resolving the outstanding decision; otherwise stop and report the missing choice. Silence is not consent. Each repeated task requires an independent human choice; similarity does not carry authorization forward. After compaction, if the task-scoped choice or its provenance is missing or uncertain, re-ask before applying a special mode. Do not create runtime mode state; use only the task-local parent checkpoint below.

## Task-scoped requested modes

These are meanings for a requested task scope, not runtime controls, persisted policy, or new authority. Never select a mode automatically. With no request, retain the existing Shell 4.3 applicable test-first policy.

| Mode | Contract |
| --- | --- |
| standard | Ordering only: ordinary implementation order is allowed; applicable tests remain required. Not a reduction in verification. |
| skip | Skip the test-first ordering/evidence cycle only; not a waiver of applicable runnable tests or required checks. Report ordinary validation and why lifecycle evidence is absent. |
| strict-tdd | Require observed RED, GREEN, relevant cases, and REFACTOR evidence or stop. Never invent observations or silently downgrade the requested mode. |

Strict-tdd fails closed without observed prerequisites: a clear expected behavior, an applicable runnable deterministic check, and a meaningful pre-implementation failure. A request alone is not evidence.

For strict-tdd, add the smallest behavior-level check and observe its intended failure before implementation (RED); implement the minimum change and observe it passing (GREEN); exercise relevant negative/alternate cases; refactor only while the focused tests remain green (a justified no-op is acceptable). Record exact commands and results. If no meaningful RED is possible or the runner is unavailable, stop with the specific limitation and ask whether to change the requested scope/mode; do not claim strict completion.

## Skip eligibility

Allow `skip` only with evidence of at least one limitation: no meaningful RED or no applicable automated check, the runner is unavailable, or the effect is not testable by this method. Explain the concrete effect, check, or runner limitation rather than using a task-type label. Convenience or preference is not evidence of eligibility; a request to skip otherwise testable behavior is insufficient. Never waive applicable runnable tests or required validation. An unavailable runner remains a verification blocker, even if skipping the test-first lifecycle is justified; report it and do not claim completion until required verification is satisfied or its requirement is explicitly resolved by the human.

For example, passive wording may lack a meaningful pre-implementation failure but still require content checks; a mixed change retains deterministic checks for its behavioral effect. Executable configuration, routing, or other observable behavior with applicable runnable tests is not skip-eligible merely because it lives in a document.

## Task-local parent checkpoint

Only the ODD parent forwards an explicit human special-mode choice to a worker through existing delegated task/context. Include:

- Current task and scope; mode `standard|skip|strict-tdd`; reason or skip eligibility evidence.
- Original human request or closed-choice response as provenance, not merely a derived description of consent.

Only when a special mode is actually selected, the parent records the same task-local checkpoint in the ordinary ODD task record and Engram mirror. These records preserve the choice; derived summaries or child assertions never grant human authority. This is a task/context contract, with no new runtime gate, persistence API, or global/session mode state. No special-mode checkpoint is needed for ordinary default test-first work.

On compaction/resume, verify the checkpoint against retained human-choice evidence for this task and scope. If evidence is missing or uncertain, return to the interactive parent to re-consult the human before applying a special mode. With unavailable UI or headless execution, use default test-first only where safe; otherwise stop and report the missing choice. Repeated tasks never inherit a mode. Applicable runnable tests and required validation remain required under every mode.

## Handoff boundary

Report the task effect, applicability rationale, explicitly chosen task/scope/mode if any with reason and human-choice provenance, observed evidence, ordinary validation, and unresolved limitations. A mode request never overrides safety, allowed edit surfaces, required checks, or human authority. This guidance does not implement project policy, runtime mode persistence/selection or enforcement, a new worker protocol, SDD/OpenSpec integration, or native review lifecycle. Existing runtime-enforced orchestration and session scratch contracts remain unchanged.
