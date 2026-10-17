import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { __testing, createGentleAiExtension } from "../extensions/gentle-ai.ts";

// Instruction delivery and public registration contracts, not proof of model adherence.
const assets = fileURLToPath(new URL("../assets/", import.meta.url));
function rubricTool(processEnv: NodeJS.ProcessEnv = {}) {
	const tools = new Map<string, any>();
	createGentleAiExtension({ nativeReviewCli: null, processEnv })({
		on() {}, registerCommand() {},
		registerTool(tool: { name: string }) { tools.set(tool.name, tool); },
	} as unknown as ExtensionAPI);
	const tool = tools.get("gentle_tdd_rubric");
	assert.ok(tool, "explicit rubric tool must be registered");
	return tool;
}
function body() {
	return readFileSync(`${assets}optional-tdd-v3-rubric.md`, "utf8");
}
function section(heading: string) {
	const rubric = body();
	const start = rubric.indexOf(`## ${heading}\n`);
	assert.notEqual(start, -1, `missing decision contract: ${heading}`);
	return rubric.slice(start).split(/\n## /)[0];
}

test("rubric is an explicit no-argument fixed-path read, not a mode selector", async () => {
	const tool = rubricTool();
	assert.deepEqual(tool.parameters, { type: "object", properties: {}, additionalProperties: false });
	assert.equal((await tool.execute("read", {})).content[0].text, body());
	for (const input of [{ path: "/other/asset" }, { mode: "skip" }, null, [], "skip"]) {
		await assert.rejects(() => tool.execute("invalid", input), /no arguments/i);
	}
	await assert.rejects(() => rubricTool({ GENTLE_PI_AGENTS_CHILD: "1" }).execute("child", {}), /parent/i);
});

test("ordinary parent prompt retains its default without eagerly injecting the rubric", () => {
	const tool = rubricTool();
	assert.match(tool.description, /Parent-only read-only reference for genuinely unresolved task test applicability\/classification or a requested task-scoped mode/);
	assert.match(tool.description, /No automatic classification or mode selection/);
	const prompt = __testing.renderOrchestratorPrompt(assets);
	assert.ok(__testing.buildGentlePrompt("gentleman").includes(
		"For behavior changes with applicable runnable deterministic tests and a clear expected outcome, use test-first by default: observe RED, GREEN, then refactor with focused checks.",
	));
	assert.doesNotMatch(prompt, /gentle_tdd_rubric|optional-tdd-v3-rubric\.md|# Task-scoped optional TDD v3 rubric|\| strict-tdd \|/);
});

test("ambiguous applicability uses closed human choices while explicit scoped requests suffice", () => {
	const choice = section("Human choice before a special mode");
	for (const rule of [/unresolved applicability.*requested special mode/i, /task, scope, and mode/i,
		/unambiguous human task-specific request.*counts as.*choice/i, /ambiguous.*ask_user_choice.*closed/i,
		/reason.*provenance/i, /never infer.*file type.*test presence.*prior task/i]) assert.match(choice, rule);
});

test("cancel, headless, repeated tasks and uncertain resumed provenance never grant authority", () => {
	const choice = section("Human choice before a special mode");
	for (const rule of [/cancel.*headless.*unavailable interaction.*no special mode/i,
		/default.*safely.*otherwise stop/i, /silence.*not.*consent/i,
		/each repeated task.*independent.*choice/i, /after compaction.*missing or uncertain.*re-ask/i,
		/do not create.*runtime mode state/i]) assert.match(choice, rule);
});

test("parent checkpoint retains original scoped human evidence without new runtime authority", () => {
	const handoff = section("Task-local parent checkpoint");
	for (const rule of [/only the ODD parent.*explicit human.*choice/i, /existing delegated task\/context/i,
		/current task and scope.*standard\|skip\|strict-tdd.*reason or skip eligibility/i,
		/original human request or closed-choice response.*provenance/i,
		/only when a special mode is actually selected/i, /same.*checkpoint.*ordinary ODD task record.*Engram mirror/i,
		/derived summaries.*child assertions.*never.*human authority/i, /no new.*persistence API.*global\/session mode state/i,
		/compaction\/resume.*verify.*checkpoint.*retained human-choice evidence/i,
		/missing or uncertain.*interactive parent.*re-consult.*human/i,
		/unavailable UI or headless.*default test-first.*safe.*otherwise stop/i,
		/repeated tasks.*never inherit.*mode/i, /applicable runnable tests.*required/i]) assert.match(handoff, rule);
});

test("skip requires effect-based evidence and never excuses runnable checks", () => {
	const skip = section("Skip eligibility");
	for (const rule of [/only.*evidence/i, /no meaningful RED.*no applicable automated check/i,
		/runner.*unavailable/i, /effect.*not testable by this method/i, /never waive.*applicable runnable tests/i,
		/unavailable runner remains a verification blocker/i, /preference.*not.*eligibility/i]) assert.match(skip, rule);
});

test("strict prerequisites fail closed and standard changes ordering only", () => {
	const rubric = body();
	for (const rule of [/standard.*Ordering only.*applicable tests remain required/i,
		/strict-tdd.*observed RED.*GREEN.*cases.*REFACTOR.*stop/i,
		/strict-tdd.*fails closed.*prerequisites/i, /no meaningful RED.*runner is unavailable.*stop/is]) assert.match(rubric, rule);
});

test("existing package asset surface delivers the effect-based rubric", () => {
	const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	assert.ok(manifest.files.includes("assets/"));
	for (const rule of [/skip.*not a waiver/i, /effect, not.*file extension/i, /prompt.*behavior/i,
		/passive documentation/i, /unavailable runner/i, /no automatic.*mode/i]) assert.match(body(), rule);
});
