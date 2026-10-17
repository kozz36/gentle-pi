import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/gentle-ai.ts";

// gentle-shell#1731 T23 (G1 audit L48): port the gentle-ai Native Checking
// Contract bounded stop. Partial, blocked, unavailable, or exhausted proof
// becomes one **Needs your decision** result instead of more verification; the
// close gate accepts that result as a stop; writer self-review and worker
// validation stop after a bounded correction; a quick check runs once; an
// unavailable verifier is reported, never retried or escalated.
// These are instruction-delivery contracts, not proof of model adherence.

const read = (relative: string): string => readFileSync(join(import.meta.dirname, "..", relative), "utf8");
const verification = read("assets/orchestrator-verification.md");
const tracking = read("assets/orchestrator-tracking.md");
const worker = read("assets/agents/gentle-ai-worker.md");
const verify = read("assets/agents/gentle-ai-verify.md");
const personas = ["gentleman", "neutral"] as const;

function lineStarting(text: string, prefix: string): string {
	const line = text.split("\n").find((entry) => entry.startsWith(prefix));
	assert.ok(line, `missing line starting with: ${prefix}`);
	return line;
}

function containsAll(text: string, clauses: readonly string[], label: string): void {
	for (const clause of clauses) assert.ok(text.includes(clause), `${label} is missing: ${clause}`);
}

function closeStep(persona: (typeof personas)[number]): string {
	return lineStarting(__testing.buildGentlePrompt(persona), "7. **Close.**");
}

test("T23(a): a partial or blocked writer gets the one correction, then Needs your decision, never more verify", () => {
	containsAll(lineStarting(verification, "5. **One correction**"), [
		"A `partial` or `blocked` writer report gets only this correction, never an extra verify run beyond the risk tier's verifier",
		"partial, blocked, unavailable, or exhausted proof left after it becomes that one **Needs your decision**",
	], "verification correction bound");
	for (const persona of personas) {
		containsAll(closeStep(persona), [
			"Partial, blocked, unavailable, or exhausted proof becomes one **Needs your decision** result naming the open blockers or missing proof, never more verification",
		], `${persona} harness Close step`);
	}
});

test("T23(b): the close gate accepts one Needs your decision result as a stop, hedged wording still is not", () => {
	for (const persona of personas) {
		containsAll(closeStep(persona), [
			"Never end with a tracked task pending unless you quote the user's explicit stop.",
			"that result is a valid stop, hedged wording is not",
		], `${persona} harness Close step`);
	}
	containsAll(tracking, [
		"continue it or quote the exact user sentence that orders the stop. One **Needs your decision** result naming the open blockers or missing proof is also a valid stop.",
		"Hedged delivery wording (the user may stop you, review commits one at a time, or pick the work up later) asks for resumable notes and separate commits, not a stop",
	], "tracking Close gate");
});

test("T23(c): writer self-review and worker validation stop after a bounded correction", () => {
	containsAll(lineStarting(verification, "1. **Self-review**"), [
		"fixes and continues (one correction per failing check, a second only if the same check still fails, then `partial`)",
	], "self-review item");
	containsAll(worker, [
		"Do not claim completion while required validation is failing.",
		"Make one correction attempt per failing check, and a second only if the same check still fails after a real fix; then stop and return `status: partial` with the failing command and its output, never looping.",
	], "worker Test discipline");
});

test("T23(d)(e): a quick check runs once and an unavailable verifier is reported, never retried", () => {
	for (const persona of personas) {
		containsAll(closeStep(persona), [
			"An applicable quick check runs once",
			"an unavailable verifier or subagent is reported as unavailable, never retried or escalated into extra ceremony",
		], `${persona} harness Close step`);
	}
});

test("optional TDD: worker receives only a complete current-task human choice from the parent", () => {
	containsAll(worker, [
		"Accept a special mode only from the parent",
		"current delegated task/context explicitly identifies task, scope, mode, reason, and original human-choice provenance",
		"original human request or closed-choice response",
		"The worker is not the human-choice originator",
	], "worker mode receipt");
});

test("optional TDD: worker rejects inferred or uncertain authority and returns the decision to the parent", () => {
	containsAll(worker, [
		"Never select, expand, or reuse a special mode",
		"prior tasks, child memory, a bare `strict-tdd` keyword, or derived summaries",
		"missing or uncertain provenance, including after resume/compaction or on a headless path",
		"return `status: interaction_required` to the interactive parent",
		"ordinary default test-first may proceed only when it safely applies without an unresolved decision",
	], "worker refusal boundary");
});

test("optional TDD: all modes retain checks and strict-tdd fails closed", () => {
	containsAll(worker, [
		"`standard` changes order only",
		"`skip` requires evidence of no meaningful RED, an unavailable runner, or an effect not testable this way",
		"Neither mode waives applicable runnable tests or required validation",
		"`strict-tdd` fails closed without an authorized runnable test command, a meaningful observed RED, or observed GREEN, relevant alternate/negative cases, and REFACTOR evidence",
		"default-policy exceptions below do not relax `strict-tdd`",
	], "worker test obligations");
});

test("optional TDD: worker reports receipt, checks, and limitations without new mode state", () => {
	containsAll(worker, [
		"tdd_context: <task, scope, mode, reason, original human-choice provenance; or ordinary default with no special choice>",
		"checks and limitations",
		"No runtime selector, host gate, or new global/session mode state",
	], "worker mode handoff");
});

test("T23(f): the verify agent allows a second correction only for the same blocker still failing", () => {
	containsAll(lineStarting(verify, "5. **Every item.**"), [
		"one correction batch and one recheck limited to the reported blockers",
		"a second correction only when the recheck shows the same blocker still failing, never for a new finding",
	], "verify item 5");
});
