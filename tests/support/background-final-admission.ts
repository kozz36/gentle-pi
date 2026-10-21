import childProcess from "node:child_process";
import { mkdirSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { runToolCall, type ToolExecutionAdmission } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import { createMonitorController } from "../../lib/background-monitor.ts";
import {
	createEventBus, createLocalBashOperations, ExtensionRunner, ModelRegistry,
	ModelRuntime, SessionManager, wrapRegisteredTools,
} from "@earendil-works/pi-coding-agent";
import { createJobRegistry, type JobRecord } from "../../lib/background-jobs.ts";
import { registerBackgroundJobTools } from "../../lib/background-jobs-tools.ts";

// Use the installed SDK's real factory loader, not a fabricated ExtensionAPI or
// invocation context. The loader is a compiled module, not a root SDK export.
const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { createExtensionRuntime, loadExtensionFromFactory } = await import(loaderUrl.href);

export async function createBackgroundAdmissionFixture(cwd: string) {
	const outputDir = join(cwd, "output");
	mkdirSync(outputDir, { mode: 0o700 });
	const settled: JobRecord[] = [];
	const counters = { shell: 0, outputDir: 0, clock: 0, changed: 0 };
	let notify = () => {};
	const waitForSettled = (count: number) => new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Job settlement timed out")), 5000);
		notify = () => { if (settled.length >= count) { clearTimeout(timer); resolve(); } };
		notify();
	});
	const monitorsNotices: unknown[] = [];
	const registry = createJobRegistry({
		nativeShell: () => ({ shellPath: "/bin/sh", commandPrefix: "# native background fixture" }),
		outputDir: () => { counters.outputDir++; return outputDir; },
		now: () => { counters.clock++; return 1000; },
		shell: () => {
			counters.shell++;
			return { operations: createLocalBashOperations({ shellPath: "/bin/sh" }) };
		},
		onSettled: job => { monitors.finish(job); settled.push(job); notify(); },
	});
	const monitors = createMonitorController({
		registry, now: () => Date.now(), deliver: notice => { monitorsNotices.push(notice); },
		schedule: (fn, ms) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); },
	});
	const sessions = SessionManager.inMemory(cwd);
	const runtime = createExtensionRuntime();
	const extension = await loadExtensionFromFactory(
		(pi: Parameters<typeof registerBackgroundJobTools>[0]) => registerBackgroundJobTools(pi, {
			registry, monitors,
			sessionId: ctx => ctx.sessionManager.getSessionId() ?? "",
			now: () => 1000,
			onChange: () => { counters.changed++; },
		}), cwd, createEventBus(), runtime,
	);
	const models = await ModelRuntime.create({
		modelsPath: null, refreshOnCreate: false, allowModelNetwork: false,
		authPath: join(cwd, "synthetic-auth.json"),
	});
	const runner = new ExtensionRunner([extension], runtime, cwd, sessions, new ModelRegistry(models));
	runner.setUIContext({ ...runner.getUIContext(), confirm: async () => false }, "rpc");
	const tools = wrapRegisteredTools(runner.getAllRegisteredTools(), runner);
	const assistantMessage: AssistantMessage = {
		role: "assistant", content: [], api: "openai-responses", provider: "synthetic", model: "synthetic",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "toolUse", timestamp: 0,
	};
	const dispatch = (name: string, args: ToolCall["arguments"], admission: boolean | ToolExecutionAdmission = false, signal?: AbortSignal, id = "reused-call") => runToolCall(
		{ type: "toolCall", id, name, arguments: args },
		{ tools, context: { messages: [], tools }, assistantMessage, signal,
			...(admission ? { beforeToolCall: async () => ({ admission: admission === true ? {
				isValid: () => true,
				evaluate: () => "allow" as const,
				approve: async () => { throw new Error("Unexpected confirmation in allow fixture"); },
			} : admission }) } : {}),
		},
	);
	return { registry, settled, counters, outputDir, dispatch, waitForSettled, monitorsNotices, monitors, tools };
}

/** Pass-through OS observation; no replacement executor, binding or approval. */
export function observeNativeStarts() {
	const original = childProcess.spawn;
	let starts = 0;
	const actual: Array<{ stdout: string; stderr: string; exitCode: number | null }> = [];
	const closes: Promise<void>[] = [];
	childProcess.spawn = ((...args: Parameters<typeof original>) => {
		const child = Reflect.apply(original, childProcess, args);
		const row: { stdout: string; stderr: string; exitCode: number | null } = { stdout: "", stderr: "", exitCode: null };
		actual.push(row);
		child.once("spawn", () => { starts++; });
		child.stdout?.on("data", data => { row.stdout += data.toString(); });
		child.stderr?.on("data", data => { row.stderr += data.toString(); });
		closes.push(new Promise<void>(resolve => { child.once("close", code => { row.exitCode = code; resolve(); }); }));
		return child;
	}) as typeof original;
	syncBuiltinESMExports();
	return {
		count: () => starts, actual,
		closed: () => new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("Native close timed out")), 5000);
			void Promise.all(closes).then(() => { clearTimeout(timer); resolve(); }, reject);
		}),
		restore() { childProcess.spawn = original; syncBuiltinESMExports(); },
	};
}
