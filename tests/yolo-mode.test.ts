import { observeNativeAdmissions, type AdmissionObservation, createNativeSession, sdk, createGentleAiExtension, fauxAssistantMessage, fauxToolCall } from "./support/bash-preexec-fixture.ts";
import assert from "node:assert/strict";
import childProcess, { execFileSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureReviewSessionIdentity, grantReviewSessionPermission, hasReviewSessionPermission, revokeReviewSessionPermission } from "../lib/review-session-standing-permission.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { YOLO_STATUS_TEXT } from "../lib/yolo-session-policy.ts";

const ON_TEXT = "🚀 YOLO ON 🔥 — destructive confirmations remain";
const USAGE = "Use /gentle:yolo enable|disable|status. State unchanged.";
const STALE_MENU = "YOLO unchanged — the session changed while the menu was open.";
const menuTitle = (state: "ON" | "OFF") => `🚀 Gentle YOLO 🔥 — standing permission (current: ${state})`;

// An empty env would resolve the developer's real ~/.pi/gentle-ai and inherit its persisted mode default.
const isolatedConfigHomes: string[] = [];
process.once("exit", () => { for (const home of isolatedConfigHomes) rmSync(home, { recursive: true, force: true }); });
function isolatedConfigHome(): string {
	const home = mkdtempSync(join(tmpdir(), "yolo-config-"));
	isolatedConfigHomes.push(home);
	return home;
}

export async function harness(t: test.TestContext, overrides: NodeJS.ProcessEnv = {}, options: { gitIdentity?: boolean } = {}) {
	const env: NodeJS.ProcessEnv = { GENTLE_PI_CONFIG_HOME: isolatedConfigHome(), ...overrides };
	const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }>();
	const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
	const tools: string[] = [];
	const notices: string[] = [];
	const statuses = new Map<string, string | undefined>();
	const widgets = new Map<string, unknown>();
	const admissions: AdmissionObservation[] = [];
	let confirmations = 0;
	let questionCallbacks = 0;
	const root = mkdtempSync(join(tmpdir(), "yolo-native-"));
	// Only the standing-review identity case owns a Git repository, before any session/cache exists.
	if (options.gitIdentity) execFileSync("git", ["init", "--quiet", "--template=", "--initial-branch=verification"], { cwd: root });
	const sentinel = join(root, "owned-counter");
	writeFileSync(sentinel, "unchanged");
	let nativeContext!: ExtensionContext;
	const native = await createNativeSession({ cwd: root, tools: ["*"], extensionFactories: [pi => {
		const observed = new Proxy(observeNativeAdmissions(pi, admissions), { get(target, key) {
			if (key === "on") return (name: string, fn: (event: unknown, ctx: ExtensionContext) => unknown) => {
				const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list);
				return target.on(name as never, fn as never);
			};
			if (key === "registerCommand") return (name: string, value: any) => { commands.set(name, value); return target.registerCommand(name, value); };
			if (key === "registerTool") return (tool: any) => { tools.push(tool.name); return target.registerTool(tool); };
			return Reflect.get(target, key);
		} });
		createGentleAiExtension({ nativeReviewCli: null, candidateViews: null, processEnv: env,
			resolveTelemetryTriggerBinary: () => { throw new Error("disabled in test"); },
		})(observed);
		for (const name of ["bash_background", "monitor"]) pi.registerTool({ ...sdk.createBashToolDefinition(root, { requireAdmission: true, shellPath: "/bin/sh" }), name });
		pi.registerTool({ name: "ask_user", label: "Independent question fixture", description: "No answer or consent is supplied by this fixture", parameters: { type: "object", additionalProperties: true } as never,
			execute: async () => { questionCallbacks++; return { content: [{ type: "text", text: "unanswered" }], details: {} }; } });
		pi.on("session_start", (_event, ctx) => { nativeContext = ctx; });
	}] });
	t.after(() => { native.session.dispose(); rmSync(root, { recursive: true, force: true }); });
	const ui = {
		notify: (text: string) => notices.push(text),
		setStatus: (key: string, text?: string) => statuses.set(key, text),
		setWidget: (key: string, value: unknown) => widgets.set(key, value),
		confirm: async () => { confirmations++; return false; },
	};
	await native.session.bindExtensions({ mode: "tui", uiContext: ui });
	// Only non-executing menu/scope unit checks use these controlled overrides.
	// Every model tool below receives the SDK's own context, never this facade.
	const unitOverrides: Record<string, unknown> = { ui };
	const ctx = new Proxy(nativeContext, {
		get: (target, key) => Object.hasOwn(unitOverrides, key) ? unitOverrides[String(key)] : Reflect.get(target, key),
		set: (_target, key, value) => { unitOverrides[String(key)] = value; return true; },
	});
	const observations: Array<{ toolName: string; callbacks: number; attempts: number; outcome: unknown }> = [];
	return { ctx, commands, tools, notices, statuses, widgets, observations, questionCallbacks: () => questionCallbacks, confirmations: () => confirmations,
		setSessionId: (id: string) => { unitOverrides.sessionManager = new Proxy(nativeContext.sessionManager, { get: (target, key) => key === "getSessionId" ? () => id : Reflect.get(target, key) }); },
		command: async (args: string) => { const cmd = commands.get("gentle:yolo"); assert.ok(cmd, "/gentle:yolo registered"); await cmd.handler(args, ctx); },
		setSelect: (select: (title: string, options: string[]) => Promise<string | undefined>) => { Object.assign(ctx.ui, { select }); },
		emit: async (name: string, event: unknown) => {
			if (name !== "tool_call") {
				let result: unknown; for (const fn of handlers.get(name) ?? []) { const next = await fn(event, ctx); if (next !== undefined) result = next; } return result;
			}
			const input = event as { toolName: string; input: { command?: string } };
			const admissionStart = admissions.length;
			let legacyProgress = 0;
			const attempts: Parameters<typeof childProcess.spawn>[] = [];
			const outcomes: Array<{ isError: boolean; result: { content: Array<{ type: string; text?: string }> } }> = [];
			const unsubscribe = native.session.subscribe((entry: any) => {
				if (entry.type === "tool_execution_update" && entry.partialResult.content.length === 0) legacyProgress++;
				if (entry.type === "tool_execution_end") outcomes.push(entry);
			});
			const originalSpawn = childProcess.spawn;
			const stopped = "YOLO fixture categorically stopped OS process creation";
			childProcess.spawn = ((...args: Parameters<typeof originalSpawn>) => { attempts.push(args); throw new Error(stopped); }) as unknown as typeof originalSpawn;
			syncBuiltinESMExports();
			native.faux.setResponses([fauxAssistantMessage([fauxToolCall(input.toolName, input.input)], { stopReason: "toolUse" }), fauxAssistantMessage("done")]);
			try { await native.session.agent.prompt({ role: "user", content: "Check only the owned native admission fixture.", timestamp: 1 }); }
			finally { unsubscribe(); childProcess.spawn = originalSpawn; syncBuiltinESMExports(); }
			assert.equal(outcomes.length, 1); assert.equal(readFileSync(sentinel, "utf8"), "unchanged");
			const outcome = outcomes[0];
			const reason = outcome.result.content.map(block => block.text ?? "").join("\n");
			const visits = admissions.slice(admissionStart);
			const callbacks = visits.filter(entry => entry.method === "evaluate").length;
			assert.equal(legacyProgress, 0, "native policy evaluation is not legacy progress");
			assert.ok(visits.filter(entry => entry.method === "isValid").every(entry => entry.result === true));
			observations.push({ toolName: input.toolName, callbacks, attempts: attempts.length, outcome });
			if (attempts.length) {
				assert.equal(attempts.length, 1); assert.equal(callbacks, 1);
				assert.equal((attempts[0][1] as string[]).at(-1), input.input.command);
				assert.equal((attempts[0][2] as { cwd: string }).cwd, root);
				assert.equal(outcome.isError, true); assert.equal(reason, stopped);
				return undefined; // admitted at the actual final boundary, but no OS process ran
			}
			if (!outcome.isError) { assert.equal(input.toolName, "ask_user"); return undefined; }
			assert.ok([
				"Tool execution admission denied",
				"Gentle AI safety policy blocked a destructive shell command. Ask the user for an explicit safer plan.",
				"Gentle AI child safety blocked a recognized destructive command. Return an explicit safer plan to the parent; children cannot authorize data loss.",
			].includes(reason), `Unexpected SDK failure: ${reason}`);
			return { block: true, reason };
		},
	};
}

test("only /gentle:yolo is registered and the ON text carries the rocket and fire markers", async t => {
	const h = await harness(t);
	assert.equal(h.commands.has("yolo"), false, "bare yolo command is not registered");
	assert.ok(h.commands.has("gentle:yolo"));
	assert.equal(YOLO_STATUS_TEXT, ON_TEXT);
});

test("human command enable/disable/status/invalid and status/widget clearing", async t => {
	const h = await harness(t);
	assert.equal(h.tools.some((name) => name.includes("yolo")), false);
	await h.command("status"); assert.match(h.notices.at(-1)!, /OFF/);
	await h.command("enable");
	assert.equal(h.statuses.get("gentle:yolo"), ON_TEXT);
	assert.deepEqual(h.widgets.get("gentle:yolo"), [ON_TEXT]);
	for (const invalid of ["invalid", "on", "off", "toggle"]) {
		await h.command(invalid);
		assert.equal(h.notices.at(-1), USAGE);
		assert.equal(h.statuses.get("gentle:yolo"), ON_TEXT, `${invalid} leaves state unchanged`);
	}
	await h.command("status"); assert.match(h.notices.at(-1)!, /ON/);
	await h.command("disable"); assert.equal(h.statuses.get("gentle:yolo"), undefined);
	assert.equal(h.widgets.get("gentle:yolo"), undefined);
	await h.command("status"); assert.match(h.notices.at(-1)!, /OFF/);
});

test("no argument without a select-capable UI reports status and never toggles", async t => {
	const h = await harness(t);
	await h.command(""); assert.equal(h.notices.at(-1), "YOLO OFF");
	assert.equal(h.statuses.get("gentle:yolo"), undefined);
	await h.command("enable");
	await h.command(""); assert.equal(h.notices.at(-1), ON_TEXT);
	assert.equal(h.statuses.get("gentle:yolo"), ON_TEXT);
	let prompts = 0;
	h.setSelect(async () => { prompts++; return "disable"; });
	Object.assign(h.ctx, { hasUI: false });
	await h.command("");
	assert.equal(prompts, 0, "headless callers never see the menu");
	assert.match(h.notices.at(-1)!, /OFF/, "headless status reflects fail-closed scope, not a menu choice");
});

test("no-argument menu shows the fire title and live state; only an explicit selection changes it", async t => {
	const h = await harness(t);
	const prompts: Array<{ title: string; options: string[] }> = [];
	let answer: string | undefined;
	h.setSelect(async (title, options) => { prompts.push({ title, options }); return answer; });
	const notices = h.notices.length;
	await h.command("");
	assert.deepEqual(prompts.at(-1), { title: menuTitle("OFF"), options: ["enable", "disable", "status"] });
	assert.equal(h.notices.length, notices, "cancel does nothing");
	assert.equal(h.statuses.get("gentle:yolo"), undefined);
	answer = "status"; await h.command("");
	assert.equal(h.notices.at(-1), "YOLO OFF"); assert.equal(h.statuses.get("gentle:yolo"), undefined);
	answer = "enable"; await h.command("");
	assert.equal(h.statuses.get("gentle:yolo"), ON_TEXT); assert.equal(h.notices.at(-1), ON_TEXT);
	answer = undefined; await h.command("");
	assert.equal(prompts.at(-1)!.title, menuTitle("ON"));
	assert.equal(h.statuses.get("gentle:yolo"), ON_TEXT, "cancel leaves ON unchanged");
	answer = "disable"; await h.command("");
	assert.equal(h.statuses.get("gentle:yolo"), undefined); assert.equal(h.notices.at(-1), "YOLO OFF");
	const shown = prompts.length;
	await h.command("status"); await h.command("invalid");
	assert.equal(prompts.length, shown, "explicit arguments bypass the menu");
	assert.equal(h.notices.at(-1), USAGE);
});

test("revocation wins over an activation still awaiting Git identity", async t => {
	for (const reason of ["off", "reload", "new", "resume", "fork", "quit"]) {
		const h = await harness(t);
		const pending = h.command("enable");
		if (reason === "off") await h.command("disable");
		else await h.emit("session_shutdown", { reason });
		await pending;
		await h.command("status"); assert.match(h.notices.at(-1)!, /OFF/);
		assert.equal(h.widgets.get("gentle:yolo"), undefined);
	}
});

test("child, headless, RPC and nonexistent workspace cannot activate", async t => {
	for (const variant of ["child", "headless", "rpc", "no-workspace"]) {
		const h = await harness(t, variant === "child" ? { GENTLE_PI_AGENTS_CHILD: "1" } : {});
		if (variant === "headless") Object.assign(h.ctx, { hasUI: false });
		if (variant === "rpc") Object.assign(h.ctx, { mode: "rpc" });
		if (variant === "no-workspace") Object.assign(h.ctx, { cwd: "/nonexistent-gentle-workspace" });
		await h.command("enable"); assert.notEqual(h.statuses.get("gentle:yolo"), ON_TEXT);
		h.setSelect(async () => "enable");
		await h.command(""); assert.notEqual(h.statuses.get("gentle:yolo"), ON_TEXT, `${variant} menu enable fails closed`);
	}
});

test("structured primary prompt gains and loses directive; named child does not inherit", async t => {
	const h = await harness(t);
	const options = { appendSystemPrompt: "base" };
	const event = { systemPromptOptions: options, prompt: "task", systemPrompt: "base" };
	await h.command("enable"); await h.emit("before_agent_start", event);
	assert.match(options.appendSystemPrompt, /YOLO session standing permission/);
	await h.command("disable"); await h.emit("before_agent_start", event);
	assert.doesNotMatch(options.appendSystemPrompt, /YOLO session standing permission/);
	await h.command("enable");
	await h.emit("before_agent_start", { ...event, agent: { name: "worker" } });
	assert.doesNotMatch(options.appendSystemPrompt, /YOLO session standing permission/);
	assert.ok(await h.emit("tool_call", { toolName: "bash", input: { command: "git push origin main" } }), "named child has no push waiver");
});

test("session loss and shutdown (including reload) revoke visible state", async t => {
	for (const reason of ["new", "resume", "fork", "reload", "quit"]) {
		const h = await harness(t); await h.command("enable");
		const event = { prompt: "task", systemPromptOptions: { appendSystemPrompt: "base" } };
		await h.emit("before_agent_start", event);
		assert.match(event.systemPromptOptions.appendSystemPrompt, /YOLO session standing permission/);
		await h.emit("session_shutdown", { reason });
		assert.equal(h.widgets.get("gentle:yolo"), undefined);
		assert.equal(h.statuses.get("gentle:yolo"), undefined);
		await h.emit("before_agent_start", event);
		assert.doesNotMatch(event.systemPromptOptions.appendSystemPrompt, /YOLO session standing permission/);
		await h.command("status"); assert.match(h.notices.at(-1)!, /OFF/);
	}
	const h = await harness(t); await h.command("enable"); h.setSessionId("replacement");
	await h.command("status"); assert.match(h.notices.at(-1)!, /OFF/);
});

test("active YOLO waives only ordinary push after full destructive/guard evaluation", async t => {
	const h = await harness(t);
	const call = (command: string) => h.emit("tool_call", { toolName: "bash", input: { command } });
	assert.deepEqual(await call("git push origin main"), { block: true, reason: "Tool execution admission denied" });
	await h.command("enable");
	assert.equal(await call("git push origin main"), undefined);
	assert.equal(h.confirmations(), 1);
	// gentle-shell#2172: reversible compound delivery is waived too.
	for (const command of ["git commit -m 'fix: x' && git push -u origin feature/x", "git push origin main && gh pr create --fill", "git -C /other push origin main", "git rebase origin/main && git push"]) {
		assert.equal(await call(command), undefined, command);
	}
	assert.equal(h.confirmations(), 1, "waived commands never reach the confirmation dialog");
	for (const command of ["git push origin main && rm -rf ./data", `sh -c "psql -c 'DROP TABLE users'"`, "git push origin main && git rebase -i main", "git push --force origin main", "git push origin main && npm publish", "git push origin :main", "sh -c 'git push origin main'"]) {
		assert.ok(await call(command), command);
	}
	await h.command("disable"); assert.ok(await call("git push origin main"));
});

test("affirmative UI cannot waive hard or configured native denials under YOLO", async t => {
	const h = await harness(t);
	await h.command("enable");
	let prompts = 0;
	Object.assign(h.ctx.ui, { confirm: async () => { prompts++; return true; } });
	const call = (command: string) => h.emit("tool_call", { toolName: "bash", input: { command } });
	for (const command of ["git push --force origin main", "rm -rf /"]) {
		assert.deepEqual(await call(command), { block: true, reason: "Gentle AI safety policy blocked a destructive shell command. Ask the user for an explicit safer plan." });
	}
	const configHome = isolatedConfigHome();
	const previousHome = process.env.GENTLE_PI_CONFIG_HOME;
	process.env.GENTLE_PI_CONFIG_HOME = configHome;
	try {
		writeFileSync(join(configHome, "runtime-guardrails.json"), JSON.stringify({ autonomousMode: true, guardedCommands: { gitPush: "block" } }));
		assert.deepEqual(await call("git push origin main"), { block: true, reason: "Gentle AI safety policy blocked a destructive shell command. Ask the user for an explicit safer plan." });
	} finally {
		if (previousHome === undefined) delete process.env.GENTLE_PI_CONFIG_HOME;
		else process.env.GENTLE_PI_CONFIG_HOME = previousHome;
	}
	assert.equal(prompts, 0, "an affirmative UI is never consulted for a non-appealable denial");
	assert.deepEqual(h.observations.map(({ callbacks, attempts }) => ({ callbacks, attempts })), [
		{ callbacks: 1, attempts: 0 }, { callbacks: 1, attempts: 0 }, { callbacks: 1, attempts: 0 },
	]);
});

test("active YOLO waives a push with harmless redirections and a read-only filter; Normal and children still ask", async t => {
	const command = "git push -u origin feat/x 2>&1 | tail -5";
	const call = (h: Awaited<ReturnType<typeof harness>>, input: string) => h.emit("tool_call", { toolName: "bash", input: { command: input } });
	const h = await harness(t);
	assert.ok(await call(h, "git push origin main 2>&1"), "Normal mode still confirms");
	assert.equal(h.confirmations(), 1);
	await h.command("enable");
	assert.equal(await call(h, command), undefined);
	assert.equal(await call(h, "git push origin main 2>&1"), undefined);
	assert.equal(h.confirmations(), 1, "waived pushes never reach the confirmation dialog");
	for (const asks of ["git push origin main | sh", "git push origin main > out.txt", "git push origin main 2>&1 | tee out"]) {
		assert.ok(await call(h, asks), asks);
	}
	const child = await harness(t, { GENTLE_PI_AGENTS_CHILD: "1" });
	await child.command("enable");
	assert.ok(await call(child, command), "children never receive the waiver");
});

test("active command path preserves configured push confirmations and blocks, including legacy env override", async t => {
	const configHome = mkdtempSync(join(tmpdir(), "gentle-yolo-config-"));
	const previousHome = process.env.GENTLE_PI_CONFIG_HOME;
	const previousAutonomy = process.env.GENTLE_PI_AUTONOMOUS_MODE;
	process.env.GENTLE_PI_CONFIG_HOME = configHome;
	try {
		for (const envOverride of [undefined, "1"]) {
			if (envOverride === undefined) delete process.env.GENTLE_PI_AUTONOMOUS_MODE;
			else process.env.GENTLE_PI_AUTONOMOUS_MODE = envOverride;
			for (const action of ["confirm", "block"]) {
				writeFileSync(join(configHome, "runtime-guardrails.json"), JSON.stringify({ autonomousMode: false, guardedCommands: { gitPush: action } }));
				const h = await harness(t); await h.command("enable");
				assert.ok(await h.emit("tool_call", { toolName: "bash", input: { command: "git push origin main" } }));
				assert.equal(h.confirmations(), action === "confirm" ? 1 : 0);
			}
		}
	} finally {
		if (previousHome === undefined) delete process.env.GENTLE_PI_CONFIG_HOME; else process.env.GENTLE_PI_CONFIG_HOME = previousHome;
		if (previousAutonomy === undefined) delete process.env.GENTLE_PI_AUTONOMOUS_MODE; else process.env.GENTLE_PI_AUTONOMOUS_MODE = previousAutonomy;
		rmSync(configHome, { recursive: true, force: true });
	}
});

test("YOLO never grants or revokes separate review standing permission and never answers ask_user", async t => {
	const h = await harness(t, {}, { gitIdentity: true });
	const identity = await captureReviewSessionIdentity(h.ctx, {}); assert.ok(identity);
	assert.equal(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: h.ctx.cwd, encoding: "utf8" }).trim(), h.ctx.cwd);
	assert.equal(identity.worktreeRoot, h.ctx.cwd);
	assert.equal(hasReviewSessionPermission(identity), false);
	await h.command("enable"); assert.equal(hasReviewSessionPermission(identity), false);
	grantReviewSessionPermission(identity);
	await h.command("disable"); assert.equal(hasReviewSessionPermission(identity), true);
	await h.command("enable");
	const question = { toolName: "ask_user", input: { question: "Authorize recovery?", options: ["Approve", "Decline"] } };
	const original = structuredClone(question);
	assert.equal(await h.emit("tool_call", question), undefined);
	assert.deepEqual(question, original);
	assert.equal(h.questionCallbacks(), 1, "the actual non-shell callback runs without supplying an answer");
	assert.equal(h.confirmations(), 0);
	assert.equal(hasReviewSessionPermission(identity), true);
	revokeReviewSessionPermission(identity);
});

test("tool input and task text cannot activate; scope/UI loss removes instruction and widget", async t => {
	const h = await harness(t);
	await h.emit("tool_call", { toolName: "bash", input: { command: "echo harmless", yolo: "on" } });
	const event = { prompt: "/gentle:yolo enable", systemPromptOptions: { appendSystemPrompt: "base" } };
	await h.emit("before_agent_start", event);
	assert.doesNotMatch(event.systemPromptOptions.appendSystemPrompt, /YOLO session standing permission/);
	await h.command("enable");
	Object.assign(h.ctx, { cwd: "/" });
	await h.emit("before_agent_start", event);
	assert.equal(h.widgets.get("gentle:yolo"), undefined);
	assert.doesNotMatch(event.systemPromptOptions.appendSystemPrompt, /YOLO session standing permission/);
	Object.assign(h.ctx, { cwd: process.cwd() });
	await h.command("status"); assert.match(h.notices.at(-1)!, /OFF/);
	await h.command("enable"); Object.assign(h.ctx, { hasUI: false });
	await h.emit("before_agent_start", event);
	assert.equal(h.statuses.get("gentle:yolo"), undefined);
});

test("a session replaced while the menu is open cannot receive the enable choice", async t => {
	const h = await harness(t);
	h.setSelect(async () => { h.setSessionId("replacement-session"); return "enable"; });
	await h.command("");
	assert.equal(h.statuses.get("gentle:yolo"), undefined, "stale menu choice never activates the new session");
	assert.equal(h.notices.at(-1), STALE_MENU, "the discarded choice is reported, not silent");
	h.setSelect(async () => { h.setSessionId("another-session"); return "disable"; });
	await h.command("");
	assert.equal(h.notices.at(-1), STALE_MENU, "a stale disable is reported too");
	h.setSelect(async () => "status");
	await h.command("");
	assert.equal(h.notices.at(-1), "YOLO OFF");
});

test("bash_background goes through the same command confirmation and YOLO waiver as bash", async t => {
	const h = await harness(t);
	const call = (command: string) => h.emit("tool_call", { toolName: "bash_background", input: { command } });
	assert.deepEqual(await call("git push origin main"), { block: true, reason: "Tool execution admission denied" });
	await h.command("enable");
	assert.equal(await call("git push origin main"), undefined);
	assert.ok(await call("git push origin main && rm -rf ./data"), "YOLO never waives a destructive command");
});

test("monitor goes through the same command confirmation and YOLO waiver as bash", async t => {
	const h = await harness(t);
	const call = (command: string) => h.emit("tool_call", { toolName: "monitor", input: { command, timeout_seconds: 60 } });
	assert.deepEqual(await call("git push origin main"), { block: true, reason: "Tool execution admission denied" });
	await h.command("enable");
	assert.equal(await call("git push origin main"), undefined);
	assert.ok(await call("git push origin main && rm -rf ./data"), "YOLO never waives a destructive command");
});
