import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

// Install the real SDK alias before importing any runtime GP/SDK consumers.
// This module registers no tests and never manufactures an invocation frame.
const sdkRoot = process.env.GENTLE_PREEXEC_SDK_ROOT;
assert.ok(sdkRoot, "GENTLE_PREEXEC_SDK_ROOT must identify the patched SDK checkout");
const sdkUrl = pathToFileURL(join(sdkRoot, "packages/coding-agent/dist/index.js")).href;
registerHooks({ resolve(specifier, context, nextResolve) {
	return nextResolve(specifier === "@earendil-works/pi-coding-agent" ? sdkUrl : specifier, context);
} });
export const sdk = await import(sdkUrl);
export const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import(pathToFileURL(join(sdkRoot, "packages/ai/dist/providers/faux.js")).href);
export const { createGentleAiExtension } = await import("../../extensions/gentle-ai.ts");
export const { SessionManager } = sdk;

export type AdmissionObservation = {
	toolName: string;
	method: "evaluate" | "approve" | "isValid";
	args: unknown[];
	result?: unknown;
	error?: unknown;
};

/** Observe only public tool_call results; Core still constructs and owns native context. */
export function observeNativeAdmissions(pi: ExtensionAPI, observations: AdmissionObservation[]): ExtensionAPI {
	return new Proxy(pi, { get(target, key) {
		if (key !== "on") return Reflect.get(target, key);
		return (name: string, handler: (...args: any[]) => any) => {
			if (name !== "tool_call") return target.on(name as never, handler as never);
			return target.on("tool_call", async function (this: unknown, ...args: any[]) {
				const result = await Reflect.apply(handler, this, args);
				if (!result?.admission) return result;
				const admission = result.admission;
				const observed = new Proxy(admission, { get(owner, method) {
					const original = Reflect.get(owner, method, owner);
					if (!["evaluate", "approve", "isValid"].includes(String(method)) || typeof original !== "function") return original;
					return (...values: unknown[]) => {
						const entry: AdmissionObservation = { toolName: args[0].toolName, method: method as AdmissionObservation["method"], args: values };
						observations.push(entry);
						try {
							const value = Reflect.apply(original, owner, values);
							if (value instanceof Promise) return value.then(result => { entry.result = result; return result; }, error => { entry.error = error; throw error; });
							entry.result = value;
							return value;
						} catch (error) { entry.error = error; throw error; }
					};
				} });
				return new Proxy(result, { get(owner, key, receiver) { return key === "admission" ? observed : Reflect.get(owner, key, receiver); } });
			} as never);
		};
	} });
}

/** The existing native admission test's public SDK setup, without test registration. */
export async function createNativeSession(options: {
	cwd: string;
	agentDir?: string;
	provider?: string;
	extensionFactories: ExtensionFactory[];
	customTools?: unknown[];
	tools?: string[];
	settingsManager?: unknown;
	sessionManager?: unknown;
}) {
	const { cwd, extensionFactories } = options;
	const agentDir = options.agentDir ?? join(cwd, "agent");
	mkdirSync(agentDir, { recursive: true });
	const settingsManager = options.settingsManager ?? sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
	const modelRuntime = await sdk.ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false, authPath: join(agentDir, "auth.json") });
	const faux = fauxProvider({ provider: options.provider ?? "gp-preexec", tokensPerSecond: Infinity });
	modelRuntime.registerNativeProvider(faux.provider);
	const resourceLoader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true, extensionFactories });
	await resourceLoader.reload();
	const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime, model: faux.getModel(), thinkingLevel: "off", tools: options.tools ?? ["bash"], customTools: options.customTools ?? [], settingsManager, sessionManager: options.sessionManager ?? sdk.SessionManager.inMemory(cwd), resourceLoader });
	return { session, faux, modelRuntime, resourceLoader, settingsManager };
}
