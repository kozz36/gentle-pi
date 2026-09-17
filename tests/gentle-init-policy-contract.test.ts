import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const delegation = read("assets/orchestrator-delegation.md");
const memory = read("assets/orchestrator-memory.md");
const sddWorkflow = read("assets/sdd-orchestrator-workflow.md");
const gentleInit = read("assets/agents/gentle-init.md");
const sddInit = read("assets/agents/sdd-init.md");

function containsAll(source: string, clauses: readonly string[]): void {
	for (const clause of clauses) assert.ok(source.includes(clause), `missing contract: ${clause}`);
}

test("parent policy state matrix dispatches only creation and refresh states", () => {
	containsAll(delegation, [
		"Neutral project TDD policy routing",
		"valid, active, unchanged",
		"consume the policy without dispatching `gentle-init`",
		"absent, stale, unverifiable, or explicitly requested for update",
		"dispatch the package-owned `gentle-init`",
		"never invoke `sdd-init` to resolve ODD TDD",
		"Test files, frameworks, commands, and detected runners are evidence only",
	]);
});

test("parent publishes only the exact approved gentle-init candidate", () => {
	containsAll(delegation, [
		"candidate author and inspector",
		"parent is the only policy publisher",
		"must not author, transform, or reconcile candidate bytes",
		"materialize the exact UTF-8 candidate bytes to a non-authoritative preview",
		"compute SHA-256 itself",
		"work-type | MODE | key obligation",
		"verified complete-candidate reference, exact destination, and SHA-256 checksum",
		"bind approval to the checksum, destination, and source revision",
		"publish EXACT unchanged candidate bytes",
		"independently read back",
		"fresh `gentle-init` dispatch and new approval",
	]);
});

test("legacy policy is migration input only while the new authority is absent", () => {
	containsAll(memory, [
		"gentle-init/{project}",
		"read the new authority first",
		"sdd-init/{project}",
		"Only when the new authority is absent",
		"do not read or compare the legacy key",
		"Do not delete or update the legacy observation automatically",
		"openspec/config.yaml",
		"same approved neutral policy",
	]);
	assert.doesNotMatch(memory, /both authorities[\s\S]*compare their complete policy bytes/i);
	assert.doesNotMatch(memory, /both authorities exist[\s\S]*block/i);
	containsAll(sddWorkflow, [
		"Neutral Policy Gate",
		"same neutral policy authority as ODD",
		"dispatch `gentle-init` before `sdd-init`",
		"valid, active, and unchanged",
	]);
});

test("gentle-init is the sole candidate author and inspector while the parent alone publishes", () => {
	containsAll(sddWorkflow, [
		"`gentle-init`, the sole candidate author and inspector",
		"the parent is the sole publisher",
	]);
	assert.doesNotMatch(sddWorkflow, /`gentle-init`, the sole policy writer/i);
	assert.doesNotMatch(sddWorkflow, /`gentle-init`(?:,)?\s+(?:is|as|the)\s+(?:sole\s+)?(?:policy\s+)?(?:writer|publisher)\b/i);
});

test("gentle-init proposes manual-row changes only from explicit parent requests without approval", () => {
	containsAll(gentleInit, [
		"unless an explicit parent request asks it to propose a change",
		"Report every proposed manual-row change as a proposal, never as approval",
		"Never receive or evaluate approval",
	]);
	assert.doesNotMatch(gentleInit, /exact relayed approval/i);
	assert.doesNotMatch(gentleInit, /approval explicitly authorizes changing/i);
});

test("sdd-init is bootstrap-only and consumes parent-resolved policy", () => {
	containsAll(sddInit, [
		"bootstrap-only",
		"parent-approved neutral policy locator and status",
		"Do NOT launch child subagents",
		"Do not generate, activate, revise, approve, or persist the neutral TDD policy",
		"gentle-init/{project}",
	]);
	assert.doesNotMatch(sddInit, /topic_key.*sdd-init\/\{project\}/i);
	assert.doesNotMatch(sddInit, /Persist this phase's artifact to the active backend before returning/);
});
