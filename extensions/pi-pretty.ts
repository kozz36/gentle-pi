import { AsyncLocalStorage } from "node:async_hooks";
import { nativeAdmissionSdk } from "../lib/bash-preexec-admission.ts";
import {
	createBashToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { bundledGentlePiAgentHome } from "../lib/agent-home.ts";
import { keepNativeWorkingRow, shellEnabled } from "../lib/shell-bar.ts";
import {
	mergeDisabledTools,
	PI_PRETTY_SUPPRESSED_TOOL_NAMES,
	quietToolsEnabled,
} from "../lib/quiet-tools-config.ts";

type PiPrettyExtension = (pi: unknown, deps?: unknown) => unknown;

let piPrettyExtensionPromise: Promise<PiPrettyExtension> | undefined;

async function loadPiPrettyExtension(): Promise<PiPrettyExtension> {
	return piPrettyExtensionPromise ??= import("@heyhuynhgiabuu/pi-pretty").then(
		(piPrettyModule) => {
			const moduleCandidate: unknown = piPrettyModule;
			const extension =
				typeof moduleCandidate === "function"
					? moduleCandidate
					: piPrettyModule.default;
			if (typeof extension !== "function") {
				throw new TypeError("pi-pretty must export an extension function");
			}
			return extension as PiPrettyExtension;
		},
	);
}

// S9: pi-pretty keeps its FFF database under deps.sdk.getAgentDir(), falling
// back to $HOME/.pi/agent whatever agent home Pi runs with. In a bundled
// Gentle Shell it gets the agent home; a deps.sdk also replaces the host tool
// factories it would otherwise import, so the same five come along. Elsewhere,
// and for a host that already passes its own sdk, Pi's deps stay unchanged.
function withAgentHome(deps: unknown, env: NodeJS.ProcessEnv): unknown {
	const agentHome = bundledGentlePiAgentHome(env);
	const given = (deps ?? {}) as { sdk?: unknown };
	if (agentHome === undefined || given.sdk !== undefined) return deps;
	return {
		...given,
		sdk: {
			createReadToolDefinition,
			createBashToolDefinition,
			createLsToolDefinition,
			createFindToolDefinition,
			createGrepToolDefinition,
			getAgentDir: () => agentHome,
		},
	};
}

export default async function gentlePiPrettyExtension(
	pi: unknown,
	deps?: unknown,
	bundled?: PiPrettyExtension,
	env: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
	// gentle-shell#1690: a delegated child has no transcript to prettify, and
	// the upstream fallback would start its own file indexing in every child.
	if (env.GENTLE_PI_AGENTS_CHILD === "1") return undefined;
	if (quietToolsEnabled()) {
		process.env.PRETTY_DISABLE_TOOLS = mergeDisabledTools(
			process.env.PRETTY_DISABLE_TOOLS,
			PI_PRETTY_SUPPRESSED_TOOL_NAMES,
		);
	}
	const extension = bundled ?? await loadPiPrettyExtension();
	deps = withAgentHome(deps, env);
	// Provenance is the loaded pinned implementation, not a factory call, name,
	// schema, or ToolInfo. A supplied extension remains opaque and unsupported.
	if (bundled === undefined && typeof nativeAdmissionSdk.bindToolExecutionContext === "function") {
		const supplied = (deps ?? {}) as { sdk?: Record<string, unknown> };
		const sdk = supplied.sdk ?? nativeAdmissionSdk;
		const key = sdk.createBashToolDefinition ? "createBashToolDefinition" : "createBashTool";
		const factory = sdk[key];
		if (factory === nativeAdmissionSdk.createBashToolDefinition || factory === nativeAdmissionSdk.createBashTool) {
			const invocation = new AsyncLocalStorage<{ context: unknown; active: boolean }>();
			let delegate: { execute: object } | undefined;
			let capturedExecute: object | undefined;
			let facadeIntact: (() => boolean) | undefined;
			const strictFactory = function(this: unknown, cwd: string, options?: Record<string, unknown>) {
				const tool = Reflect.apply(factory as (...args: unknown[]) => { execute: object }, this, [cwd, { ...options, requireAdmission: true }]);
				delegate = tool;
				capturedExecute = tool.execute;
				const exactExecute = tool.execute;
				// Only the pinned plugin gets this facade. Keep the original SDK tool
				// and receiver intact; an explicit sixth argument always wins.
				const facade = { ...tool, execute: function(...args: unknown[]) {
					const scope = invocation.getStore();
					if (args.length < 6 && scope?.active) args = [...args, scope.context];
					return Reflect.apply(exactExecute as (...args: unknown[]) => unknown, tool, args);
				} };
				const forward = facade.execute;
				facadeIntact = () => facade.execute === forward;
				return facade;
			};
			deps = { ...supplied, sdk: new Proxy(sdk, { get: (target, property, receiver) => property === key ? strictFactory : Reflect.get(target, property, receiver) }) };
			const api = pi as ExtensionAPI;
			pi = new Proxy(api, { get(target, property, receiver) {
				if (property !== "registerTool") return Reflect.get(target, property, receiver);
				return (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => {
					// The pinned entry constructs and registers exactly one Bash forwarder.
					if (tool.name === "bash" && delegate && capturedExecute) {
						const exactDelegate = delegate;
						const exactExecute = capturedExecute;
						const intact = facadeIntact!;
						const pluginExecute = tool.execute;
						const wrapper: typeof tool.execute = function(this: unknown, ...args) {
							const scope = { context: args[5], active: args.length >= 6 };
							return invocation.run(scope, async () => {
								try { return await Reflect.apply(pluginExecute, this, args); }
								finally { scope.active = false; }
							});
						};
						tool.execute = wrapper;
						nativeAdmissionSdk.bindToolExecutionContext!(wrapper, exactExecute, () => exactDelegate.execute === exactExecute && intact() && tool.execute === wrapper);
						delegate = undefined;
					}
					return api.registerTool.call(api, tool);
				};
			} });
		}
	}
	if (!shellEnabled(env)) return extension(pi, deps);
	const api = pi as ExtensionAPI;
	// Scope interception to this bundled dependency, never to the shared host UI.
	// Its tools/autocomplete/status APIs pass through; prompt ownership stays with
	// Gentle Shell (or a genuine third-party editor). This also blocks stale restores.
	const owned = new Set(["setEditorComponent", "setWorkingIndicator", "setWorkingMessage", "setWorkingVisible"]);
	const delegated = new Proxy(api, {
		get(target, key) {
			if (key !== "on") return Reflect.get(target, key);
			return (event: Parameters<ExtensionAPI["on"]>[0], handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
				api.on(event, ((event: unknown, ctx: ExtensionContext) => {
					if (ctx.mode !== "tui") return handler(event, ctx);
					const ui = new Proxy(ctx.ui, {
						get(target, key) {
							return owned.has(String(key)) ? () => {} : Reflect.get(target, key);
						},
					});
					return handler(event, new Proxy(ctx, { get: (target, key) => key === "ui" ? ui : Reflect.get(target, key) }));
				}) as never);
			};
		},
	});
	// pi-pretty's hidden-thinking API is global. Its best-effort private per-row
	// patch can miss the host's actual component class and then animate every
	// historical Thinking row. Gentle Shell chooses the robust presentation:
	// keep collapsed labels static while preserving the separate working frame.
	const previousThinkingIndicator = process.env.PRETTY_THINKING_INDICATOR;
	process.env.PRETTY_THINKING_INDICATOR = "off";
	let result: unknown;
	try {
		result = await extension(delegated, deps);
	} finally {
		if (previousThinkingIndicator === undefined) delete process.env.PRETTY_THINKING_INDICATOR;
		else process.env.PRETTY_THINKING_INDICATOR = previousThinkingIndicator;
	}
	// GentlePromptEditor already carries the live working state in its frame.
	// Hide Pi's separate loader row to avoid repeating Thinking above the input;
	// transcript thinking blocks remain untouched as historical reasoning markers.
	// Inside Herdr the row stays: its native Pi detection reads it.
	api.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui" && !keepNativeWorkingRow(env)) ctx.ui.setWorkingVisible(false);
	});
	api.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setWorkingVisible(true);
		ctx.ui.setWorkingIndicator();
		ctx.ui.setWorkingMessage();
	});
	return result;
}
