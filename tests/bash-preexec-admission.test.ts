import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { sdk, fauxProvider, fauxAssistantMessage, fauxToolCall, createGentleAiExtension, createNativeSession } from "./support/bash-preexec-fixture.ts";
const { default: pretty } = await import("../extensions/pi-pretty.ts");

const artifacts = resolve(tmpdir(), "gp-preexec-integration");
mkdirSync(artifacts, { recursive: true, mode: 0o700 });

for (const mode of ["approved", "denied", "headless", "error", "cancelled", "policy-changed", "replaced", "delegate-changed", "backend-opaque", "hard-denied", "child-denied", "safe", "safe-headless", "pretty", "opaque-pretty"] as const) {
test(`GP final native invocation: ${mode}`, async () => {
	const cwd = mkdtempSync(join(artifacts, "session-"));
	const finalCwd = join(cwd, "final");
	const agentDir = join(cwd, "agent");
	mkdirSync(finalCwd); mkdirSync(agentDir);
	const command = "printf raw";
	const guardedCommand = `npm() { printf admitted; };\n# ${"long ".repeat(50)}\nnpm publish; printf x >> effect`;
	const finalCommand = mode === "hard-denied" ? "rm -rf /"
		: mode === "child-denied" ? "rm -rf owned-negative-fixture"
		: mode === "safe" || mode === "safe-headless" ? "printf admitted; printf x >> effect" : guardedCommand;
	let backendCalls = 0;
	const definition = sdk.createBashToolDefinition(cwd, { requireAdmission: true, shellPath: "/bin/sh", exposeSessionEnvironment: false,
		...(mode === "backend-opaque" ? { operations: { exec: async () => { backendCalls++; return { exitCode: 0 }; } } } : {}),
		spawnHook: (context: { command: string; cwd: string }) => ({ ...context, command: finalCommand, cwd: finalCwd }) });
	let replace!: () => void;
	let opaqueCalls = 0;
	const usePretty = mode === "pretty" || mode === "opaque-pretty";
	const realSpawn = childProcess.spawn;
	let starts = 0;
	childProcess.spawn = ((...args: Parameters<typeof realSpawn>) => {
		starts++;
		// Destructive strings are never passed to an actual OS process, even if a regression permits one.
		if (mode === "hard-denied" || mode === "child-denied") throw new Error("Forbidden process creation in a negative destructive fixture");
		return Reflect.apply(realSpawn, childProcess, args);
	}) as typeof realSpawn;
	syncBuiltinESMExports();
	const { session, faux } = await createNativeSession({ cwd, agentDir,
		extensionFactories: [createGentleAiExtension({ nativeReviewCli: null, processEnv: { ...process.env, GENTLE_PI_AGENTS_CHILD: mode === "child-denied" ? "1" : "0" } }),
			async (pi: Parameters<ReturnType<typeof createGentleAiExtension>>[0]) => {
				replace = () => pi.registerTool({ ...definition });
				if (!usePretty) { pi.registerTool(definition); return; }
				process.env.GENTLE_PI_QUIET_TOOLS = "0";
				process.env.PRETTY_DISABLE_TOOLS = "read,ls,find,grep";
				const deps = { sdk, fffModule: { FileFinder: { create: () => ({ ok: false, error: "Test indexing disabled" }) } } };
				if (mode === "pretty") {
					await pretty(pi, deps);
				} else {
					// Observing a genuine dummy factory call is not forwarding provenance.
					await pretty(pi, deps, (api, dependencies) => {
						const supplied = dependencies as typeof deps;
						const dummy = supplied.sdk.createBashToolDefinition(cwd, { requireAdmission: true });
						(api as typeof pi).registerTool({ ...dummy, execute: async () => { opaqueCalls++; return { content: [{ type: "text", text: "opaque" }], details: {} }; } });
					});
				}
			}] });

	const outcomes: { isError: boolean; result: { structuredContent?: { output: string; exit_code: number } } }[] = [];
	session.subscribe((event: { type: string }) => { if (event.type === "tool_execution_end") outcomes.push(event as unknown as typeof outcomes[number]); });
	let confirms = 0;
	let release!: (value: boolean) => void;
	let entered!: () => void;
	const waiting = new Promise<void>(resolve => { entered = resolve; });
	const ui = new Proxy({ confirm: async (_title: string, body: string) => {
		confirms++;
		assert.ok(body.includes(finalCommand), "complete final command is visible");
		assert.ok(body.includes(usePretty ? cwd : finalCwd), "final cwd is visible");
		assert.ok(body.includes("2000"), "effective timeout is visible");
		if (mode === "error") throw new Error("Confirmation unavailable");
		const answer = new Promise<boolean>(resolve => { release = resolve; }); entered(); return answer;
	} }, { get(target, key) { return Reflect.get(target, key) ?? (() => {}); } });
	await session.bindExtensions(mode === "headless" || mode === "safe-headless" ? { mode: "rpc" } : { mode: "rpc", uiContext: ui });
	// The pinned pretty factory receives its untransformed command directly.
	const inputCommand = usePretty ? guardedCommand : command;
	faux.setResponses([fauxAssistantMessage([fauxToolCall("bash", { command: inputCommand, timeout: 2 })], { stopReason: "toolUse" }), fauxAssistantMessage("done")]);
	const pending = session.prompt("Run the harmless owned counter.");
	try {
		await Promise.race([waiting, pending]);
		const needsUI = !["headless", "backend-opaque", "hard-denied", "child-denied", "safe", "safe-headless", "opaque-pretty"].includes(mode);
		assert.equal(confirms, needsUI ? 1 : 0, "only the final supported guarded command requests confirmation");
		if (needsUI && mode !== "error") {
			assert.equal(starts, 0, "waiting produces zero native starts");
			assert.equal(existsSync(join(finalCwd, "effect")), false, "waiting produces zero effects");
			if (mode === "policy-changed") {
				mkdirSync(join(cwd, ".pi/gentle-ai"), { recursive: true });
				writeFileSync(join(cwd, ".pi/gentle-ai/runtime-guardrails.json"), JSON.stringify({ autonomousMode: true, guardedCommands: { npmPublish: "allow" } }));
			}
			if (mode === "replaced") replace();
			if (mode === "delegate-changed") definition.execute = async () => { opaqueCalls++; return { content: [], details: {} }; };
			if (mode === "cancelled") {
				const aborting = session.abort();
				release(true);
				await aborting;
			} else release(mode !== "denied");
		}
		await pending;
		const allowed = mode === "approved" || mode === "safe" || mode === "safe-headless" || mode === "pretty";
		assert.equal(starts, allowed ? 1 : 0);
		assert.equal(backendCalls, 0); assert.equal(opaqueCalls, 0);
		const effect = join(usePretty ? cwd : finalCwd, "effect");
		assert.equal(existsSync(effect), allowed);
		if (allowed) {
			assert.equal(readFileSync(effect, "utf8"), "x");
			assert.equal(outcomes.length, 1); assert.equal(outcomes[0].isError, false);
			assert.equal(outcomes[0].result.structuredContent?.output, "admitted");
			assert.equal(outcomes[0].result.structuredContent?.exit_code, 0);
		} else if (mode !== "cancelled") {
			assert.equal(outcomes.length, 1); assert.equal(outcomes[0].isError, true);
		}
	} finally { release?.(false); await pending; session.dispose(); childProcess.spawn = realSpawn; syncBuiltinESMExports(); }
});
}

test("GP concurrent final approvals and reused call IDs never borrow a decision", async () => {
	const cwd = mkdtempSync(join(artifacts, "concurrent-"));
	const agentDir = join(cwd, "agent");
	mkdirSync(agentDir);
	const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
	const modelRuntime = await sdk.ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false, authPath: join(agentDir, "auth.json") });
	const faux = fauxProvider({ provider: "gp-concurrent", tokensPerSecond: Infinity });
	modelRuntime.registerNativeProvider(faux.provider);
	const plans = new Map<string, string>();
	const definition = sdk.createBashToolDefinition(cwd, {
		requireAdmission: true, shellPath: "/bin/sh", exposeSessionEnvironment: false,
		spawnHook: (context: { command: string; cwd: string }) => {
			const label = context.command.slice("printf ".length);
			assert.ok(["one", "two", "three", "four"].includes(label));
			const command = `npm() { printf ${label}; }; npm publish; printf x >> effect-${label}`;
			plans.set(label, command);
			return { ...context, command };
		},
	});
	const resourceLoader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
		extensionFactories: [createGentleAiExtension({ nativeReviewCli: null }), (pi: Parameters<ReturnType<typeof createGentleAiExtension>>[0]) => pi.registerTool(definition)] });
	await resourceLoader.reload();
	const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime, model: faux.getModel(), thinkingLevel: "off", tools: ["bash"], settingsManager, sessionManager: sdk.SessionManager.inMemory(cwd), resourceLoader });
	const confirmations = new Map<string, (approved: boolean) => void>();
	let changed = () => {};
	const ui = new Proxy({ confirm: async (_title: string, body: string) => {
		const label = [...plans].find(([, command]) => body.includes(command))?.[0];
		assert.ok(label, "confirmation must match an actual prepared command");
		assert.ok(body.includes(cwd) && body.includes("2000") && body.includes("/bin/sh"));
		return new Promise<boolean>(resolve => { confirmations.set(label, resolve); changed(); });
	} }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
	await session.bindExtensions({ mode: "rpc", uiContext: ui });
	const starts: { command: string; cwd: string }[] = [];
	const realSpawn = childProcess.spawn;
	childProcess.spawn = ((...args: Parameters<typeof realSpawn>) => {
		assert.equal(args[0], "/bin/sh");
		assert.deepEqual((args[1] as string[]).slice(0, 1), ["-c"]);
		starts.push({ command: (args[1] as string[])[1], cwd: (args[2] as { cwd: string }).cwd });
		return Reflect.apply(realSpawn, childProcess, args);
	}) as typeof realSpawn;
	syncBuiltinESMExports();
	const outcomes: { isError: boolean; result: { structuredContent?: { output: string; exit_code: number } } }[] = [];
	session.subscribe((event: { type: string }) => { if (event.type === "tool_execution_end") { outcomes.push(event as unknown as typeof outcomes[number]); changed(); } });
	let pending: Promise<void> | undefined;
	const waitFor = async (predicate: () => boolean) => {
		while (!predicate()) {
			await Promise.race([
				new Promise<void>(resolve => { changed = resolve; }),
				pending?.then(() => { assert.ok(predicate(), "public turn ended before the expected admission/result"); }),
			]);
		}
	};
	const turn = (labels: string[]) => {
		faux.setResponses([fauxAssistantMessage(labels.map(label => fauxToolCall("bash", { command: `printf ${label}`, timeout: 2 }, { id: "reused-call-id" })), { stopReason: "toolUse" }), fauxAssistantMessage("done")]);
		return session.prompt("Run only the harmless owned counters.");
	};
	try {
		pending = turn(["one", "two"]);
		await waitFor(() => confirmations.size === 2);
		assert.equal(starts.length, 0);
		assert.equal(existsSync(join(cwd, "effect-one")), false);
		assert.equal(existsSync(join(cwd, "effect-two")), false);
		confirmations.get("one")!(true);
		await waitFor(() => outcomes.length === 1);
		assert.deepEqual(starts, [{ command: plans.get("one"), cwd }]);
		assert.equal(readFileSync(join(cwd, "effect-one"), "utf8"), "x");
		assert.equal(existsSync(join(cwd, "effect-two")), false, "other invocation stays pending");
		confirmations.get("two")!(false);
		await pending;
		assert.equal(starts.length, 1);
		assert.deepEqual(outcomes.map(outcome => outcome.isError).sort(), [false, true]);
		assert.equal(outcomes.find(outcome => !outcome.isError)?.result.structuredContent?.output, "one");
		assert.equal(outcomes.find(outcome => !outcome.isError)?.result.structuredContent?.exit_code, 0);
		pending = turn(["three"]);
		await waitFor(() => confirmations.has("three"));
		assert.equal(starts.length, 1, "reused textual ID cannot reuse approval");
		confirmations.get("three")!(false);
		await pending;
		assert.equal(existsSync(join(cwd, "effect-three")), false);
		pending = turn(["four"]);
		await waitFor(() => confirmations.has("four"));
		assert.equal(starts.length, 1, "fresh decision still required after denial");
		confirmations.get("four")!(true);
		await pending;
		assert.deepEqual(starts, [{ command: plans.get("one"), cwd }, { command: plans.get("four"), cwd }]);
		assert.equal(readFileSync(join(cwd, "effect-four"), "utf8"), "x");
		assert.equal(outcomes.filter(outcome => outcome.isError).length, 2);
		assert.equal(outcomes.at(-1)?.result.structuredContent?.output, "four");
		assert.equal(outcomes.at(-1)?.result.structuredContent?.exit_code, 0);
	} finally {
		for (const release of confirmations.values()) release(false);
		await pending;
		session.dispose(); childProcess.spawn = realSpawn; syncBuiltinESMExports();
	}
});

// Keep the unsupported target profile visible as a behavioral RED until its
// actual SDK-owned constructor can opt in without replacing the selected tool.
test("default quiet profile admits the original configured native Bash owner", async (t) => {
	const cwd = mkdtempSync(join(artifacts, "default-owner-"));
	const agentDir = join(cwd, "agent");
	mkdirSync(agentDir);
	const previousQuiet = process.env.GENTLE_PI_QUIET_TOOLS;
	const previousDisabled = process.env.PRETTY_DISABLE_TOOLS;
	delete process.env.GENTLE_PI_QUIET_TOOLS;
	delete process.env.PRETTY_DISABLE_TOOLS;
	const source = (path: string) => JSON.stringify(fileURLToPath(new URL(path, import.meta.url)));
	const entry = join(cwd, "default-owner.ts");
	writeFileSync(entry, [
		`import { createGentleAiExtension } from ${source("../extensions/gentle-ai.ts")};`,
		`import quietTools from ${source("../extensions/quiet-tools.ts")};`,
		`import pretty from ${source("../extensions/pi-pretty.ts")};`,
		"export default async function(pi) {",
		"  createGentleAiExtension({ nativeReviewCli: null })(pi);",
		"  quietTools(pi, () => undefined);",
		"  await pretty(pi, { fffModule: { FileFinder: { create: () => ({ ok: false, error: 'Test indexing disabled' }) } } });",
		"}",
	].join("\n"));
	const settingsManager = sdk.SettingsManager.inMemory({
		compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off",
		shellPath: "/bin/sh", shellCommandPrefix: "# configured owner prefix",
	});
	const modelRuntime = await sdk.ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false, authPath: join(agentDir, "auth.json") });
	const faux = fauxProvider({ provider: "gp-default-owner", tokensPerSecond: Infinity });
	modelRuntime.registerNativeProvider(faux.provider);
	const resourceLoader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager,
		noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
		additionalExtensionPaths: [entry],
	});
	let session: Awaited<ReturnType<typeof sdk.createAgentSession>>["session"] | undefined;
	const realSpawn = childProcess.spawn;
	const starts: { shell: string; args: string[]; cwd: string }[] = [];
	try {
		await resourceLoader.reload();
		assert.deepEqual(resourceLoader.getExtensions().errors, [], "ordinary SDK extension loading succeeds");
		({ session } = await sdk.createAgentSession({ cwd, agentDir, settingsManager, modelRuntime, model: faux.getModel(),
			thinkingLevel: "off", tools: ["bash"], resourceLoader, sessionManager: sdk.SessionManager.inMemory(cwd) }));
		await session.bindExtensions({ mode: "rpc" });
		const outcomes: { isError: boolean; result: { content: { type: string; text?: string }[]; structuredContent?: { output: string; exit_code: number } } }[] = [];
		session.subscribe((event: { type: string }) => { if (event.type === "tool_execution_end") outcomes.push(event as unknown as typeof outcomes[number]); });
		childProcess.spawn = ((...args: Parameters<typeof realSpawn>) => {
			starts.push({ shell: args[0], args: args[1] as string[], cwd: (args[2] as { cwd: string }).cwd });
			return Reflect.apply(realSpawn, childProcess, args);
		}) as typeof realSpawn;
		syncBuiltinESMExports();
		const command = "printf default-admitted; printf x >> default-effect";
		faux.setResponses([fauxAssistantMessage([fauxToolCall("bash", { command, timeout: 2 })], { stopReason: "toolUse" }), fauxAssistantMessage("done")]);
		await session.prompt("Run the harmless owned native default-profile counter.");
		assert.equal(outcomes.length, 1);
		t.diagnostic(JSON.stringify({ starts: starts.length, effect: existsSync(join(cwd, "default-effect")),
			isError: outcomes[0].isError, text: outcomes[0].result.content.map(block => block.text ?? "").join("\n") }));
		assert.equal(starts.length, 1, "the original configured native owner must support final admission");
		assert.deepEqual(starts, [{ shell: "/bin/sh", args: ["-c", `# configured owner prefix\n${command}`], cwd }]);
		assert.equal(outcomes[0].isError, false);
		assert.equal(outcomes[0].result.structuredContent?.output, "default-admitted");
		assert.equal(outcomes[0].result.structuredContent?.exit_code, 0);
		assert.equal(readFileSync(join(cwd, "default-effect"), "utf8"), "x");
	} finally {
		session?.dispose(); childProcess.spawn = realSpawn; syncBuiltinESMExports();
		if (previousQuiet === undefined) delete process.env.GENTLE_PI_QUIET_TOOLS;
		else process.env.GENTLE_PI_QUIET_TOOLS = previousQuiet;
		if (previousDisabled === undefined) delete process.env.PRETTY_DISABLE_TOOLS;
		else process.env.PRETTY_DISABLE_TOOLS = previousDisabled;
	}
});
