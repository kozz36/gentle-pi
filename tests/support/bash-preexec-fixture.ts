import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

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
