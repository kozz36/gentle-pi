import { createNativeSession, sdk, SessionManager, createGentleAiExtension, fauxAssistantMessage, fauxToolCall } from "./support/bash-preexec-fixture.ts";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { AutoPermissionClassifier } from "../lib/auto-permission-classifier.ts";

const model = {
 id: "local", provider: "fixture", api: "fixture", name: "Local", baseUrl: "http://invalid.local",
 reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 1024,
 cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

// Public hooks plus the real ESM SDK session tree and classifier; no provider I/O.
async function fixture(t: test.TestContext) {
 const root = mkdtempSync(join(tmpdir(), "auto-invariants-")), home = join(root, "config");
 mkdirSync(home);
 const previous = process.env.GENTLE_PI_CONFIG_HOME;
 process.env.GENTLE_PI_CONFIG_HOME = home;
 t.after(() => {
  if (previous === undefined) delete process.env.GENTLE_PI_CONFIG_HOME;
  else process.env.GENTLE_PI_CONFIG_HOME = previous;
  rmSync(root, { recursive: true, force: true });
 });
 const manager = SessionManager.inMemory(root), anchor = manager.appendCustomEntry("probe-anchor", {});
 const commands = new Map<string, any>(), hooks = new Map<string, any[]>();
 const receipts: any[] = [], providerCalls: any[] = [], notices: string[] = [], statuses: any[] = [];
 let decision = "allow", pending = false, inspectPath: string | undefined, announce!: () => void, receiptChanged: (() => void) | undefined;
 const started = new Promise<void>(resolve => { announce = resolve; });
 const registry: any = {
  streamSimple(selected: any, context: any, options: any) {
   const paths=JSON.parse(context.messages[0].content).evidencePaths ?? [];
   assert.equal(options.toolChoice, paths.length ? "auto" : "none");
   assert.deepEqual(context.tools.map((tool:any)=>tool.name),paths.length ? ["inspect_permission_file"] : []);
   if(paths.length)assert.deepEqual(context.tools[0].parameters.properties.path.enum,paths);
   assert.equal(options.maxRetries, 0);
   let resolve!: (value: any) => void;
   const promise = new Promise(r => { resolve = r; });
   const call = { selected, context, options, resolve: () => resolve({
    role: "assistant", api: "fixture", provider: selected.provider, model: selected.id,
    stopReason: inspectPath && context.messages.length===1 ? "toolUse" : "stop", timestamp: 1,
    content: inspectPath && context.messages.length===1 ? [{type:"toolCall",id:"inspect",name:"inspect_permission_file",arguments:{path:inspectPath}}] :
     [{ type: "text", text: JSON.stringify({ decision, reason: decision === "deny"
     ? "Only inspection is authorized; do not change files." : "Local fixture action." }) }],
    usage: { input: 5, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 8,
     cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.02 } },
   }) };
   providerCalls.push(call);
   announce();
   if (!pending) queueMicrotask(call.resolve);
   return { result: () => promise };
  },
 };
 const engine = new AutoPermissionClassifier(registry, { deadlineMs: 1000 });
 let ctx: any;
 let lastInput: any;
 let inToolAdmission = false;
 const starts: string[] = [];
 const originalSpawn = childProcess.spawn;
 t.mock.method(childProcess, "spawn", (...args: Parameters<typeof originalSpawn>) => {
  if ((args[2] as { cwd?: string })?.cwd === root) starts.push(String((args[1] as string[])?.at(-1)));
  return Reflect.apply(originalSpawn, childProcess, args);
 });
 syncBuiltinESMExports();
 t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
 const callbacks: string[] = [];
 const native = await createNativeSession({ cwd: root, sessionManager: manager, tools: ["*"], extensionFactories: [(pi) => {
  pi.on("tool_call", event => { lastInput = event.input; inToolAdmission = true; });
  pi.on("tool_result", () => { inToolAdmission = false; });
  const observed = new Proxy(pi, { get(target, key) {
   if (key === "registerCommand") return (name: string, value: any) => { commands.set(name, value); return target.registerCommand(name, value); };
   if (key === "appendEntry") return (type: string, data: any) => {
    target.appendEntry(type, data);
    if (type === "gentle-auto-permission") { receipts.push({ type, data, manager: native.session.sessionManager }); receiptChanged?.(); }
   };
   return Reflect.get(target, key);
  } });
  createGentleAiExtension({ processEnv: { GENTLE_PI_CONFIG_HOME: home }, nativeReviewCli: null,
   candidateViews: null, resolveTelemetryTriggerBinary: () => { throw Error("network/native disabled"); }, autoPermissionClassifier: engine })(observed);
  // Harmless non-shell fixture tools preserve the historical argument grammar.
  for (const name of ["edit", "custom_fixture", "mcp__fixture__mutate", "ask_user_question", "ask_user_choice", "gentle_review", "gentle_review_capture", "subagent_status"]) pi.registerTool({ name, label: name, description: "Owned public permission fixture", parameters: { type: "object", additionalProperties: true } as never,
   execute: async () => { callbacks.push(name); return { content: [{ type: "text", text: "fixture callback" }], details: {} }; } });
  pi.on("session_start", (_event, context) => { ctx = context; });
 }] });
 t.after(() => native.session.dispose());
 const ui = new Proxy({ notify: (text: string) => notices.push(text), setStatus: (...args: any[]) => statuses.push(args), setWidget() {}, confirm: async () => false }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
 await native.session.bindExtensions({ mode: "tui", uiContext: ui });
 const emit = async (name: string, event: any) => name === "input"
  ? native.session.extensionRunner.emitInput(event.text, undefined, event.source)
  : native.session.extensionRunner.emit({ type: name, ...event });
 return {
  root, home, get ctx() { return ctx; }, manager, anchor, get receipts() { return receipts.filter(receipt => receipt.manager === native.session.sessionManager); }, providerCalls, statuses, notices, emit, commands,
  callbacks, starts, session: native.session, modelRuntime: native.modelRuntime, get lastInput() { return lastInput; }, get inToolAdmission() { return inToolAdmission; },
  input: async (text: string, source = "interactive") => {
   assert.deepEqual(await emit("input", { text, source }), { action: "continue" });
   native.session.sessionManager.appendMessage({ role: "user", content: text, timestamp: 1 });
  },
  call: async (toolName: string, input: any) => {
   const outcomes: any[] = [];
   const unsubscribe = native.session.subscribe((event: any) => { if (event.type === "tool_execution_end") outcomes.push(event); });
   native.faux.setResponses([fauxAssistantMessage([fauxToolCall(toolName, input, { id: "probe-call" })], { stopReason: "toolUse" }), fauxAssistantMessage("done")]);
   try { await native.session.prompt("Run the owned fixture action.", { source: "rpc" }); }
   finally { unsubscribe(); }
   assert.equal(outcomes.length, 1, "actual SDK dispatch produces exactly one outcome");
   return outcomes[0].isError ? { block: true, reason: outcomes[0].result.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n") } : undefined;
  },
  enable: () => commands.get("gentle:mode").handler("auto", ctx),
  setDecision(value: string) { decision = value; }, setPending(value: boolean) { pending = value; },
  inspect(path: string) { inspectPath=path; },
  started: () => deadline(started, "one inference started"),
  waitForReceipts(count: number) {
   if (receipts.length >= count) return Promise.resolve();
   return deadline(new Promise<void>(resolve => {
    receiptChanged = () => { if (receipts.length >= count) { receiptChanged = undefined; resolve(); } };
   }), `${count} receipts observed`);
  },
 };
}

test("shared native fixture classifies exact evidence before one public Bash effect", async t => {
 const root = mkdtempSync(join(tmpdir(), "shared-native-red-"));
 const calls: unknown[] = [];
 const engine = new AutoPermissionClassifier({ streamSimple(selected, context) {
  calls.push(structuredClone(context));
  return { result: async () => ({ role: "assistant", api: selected.api, provider: selected.provider, model: selected.id,
   timestamp: 1, stopReason: calls.length === 1 ? "toolUse" : "stop",
   content: calls.length === 1 ? [{ type: "toolCall", id: "inspect", name: "inspect_permission_file", arguments: { path: "check.mjs" } }]
    : [{ type: "text", text: JSON.stringify({ decision: "allow", reason: "Run only the owned fixture checker." }) }],
   usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  }) };
 } } as ConstructorParameters<typeof AutoPermissionClassifier>[0]);
 let command: { handler: (args: string, ctx: unknown) => Promise<void> };
 let context: unknown;
 const native = await createNativeSession({ cwd: root, extensionFactories: [(pi) => {
  createGentleAiExtension({ nativeReviewCli: null, candidateViews: null, autoPermissionClassifier: engine })(new Proxy(pi, {
   get(target, key) {
    if (key === "registerCommand") return (name: string, value: typeof command) => { if (name === "gentle:mode") command = value; return target.registerCommand(name, value as never); };
    return Reflect.get(target, key);
   },
  }));
  pi.on("session_start", (_event, ctx) => { context = ctx; });
 }] });
 t.after(() => { native.session.dispose(); rmSync(root, { recursive: true, force: true }); });
 const ui = new Proxy({}, { get: () => () => {} });
 await native.session.bindExtensions({ mode: "tui", uiContext: ui });
 await command!.handler("auto", context);
 const request = "Inspect check.mjs and then run only its owned counter.";
 await native.session.extensionRunner.emitInput(request, undefined, "interactive");
 native.session.sessionManager.appendMessage({ role: "user", content: request, timestamp: 1 });
 writeFileSync(join(root, "check.mjs"), "import { writeFileSync } from 'node:fs'; writeFileSync('effect', 'x'); process.stdout.write('shared-public');\n");
 const outcomes: { isError: boolean; result: { structuredContent?: { output: string; exit_code: number } } }[] = [];
 native.session.subscribe((event: { type: string }) => { if (event.type === "tool_execution_end") outcomes.push(event as unknown as typeof outcomes[number]); });
 native.faux.setResponses([fauxAssistantMessage([fauxToolCall("bash", { command: "node check.mjs" })], { stopReason: "toolUse" }), fauxAssistantMessage("done")]);
 await native.session.prompt("Run the owned fixture action.", { source: "rpc" });
 assert.equal(calls.length, 2, "actual native admission must consume classifier evidence");
 assert.equal(outcomes[0].isError, false);
 assert.equal(outcomes[0].result.structuredContent?.output, "shared-public");
 assert.equal(outcomes[0].result.structuredContent?.exit_code, 0);
 assert.equal(readFileSync(join(root, "effect"), "utf8"), "x");
});

test("public hook supplies exact script evidence without executing or modifying the script", async t=>{
 const f=await fixture(t);mkdirSync(join(f.root,"scripts"));
 const script=join(f.root,"scripts","check.mjs"), content="console.log('fixture-only');\n";
 writeFileSync(script,content);
 await f.enable();await f.input("Run the local checker after inspecting its effects.");
 f.inspect("scripts/check.mjs");
 const result=await f.call("bash",{command:"node scripts/check.mjs"});
 assert.equal(result?.block,undefined);
 assert.equal(f.providerCalls.length,2);
 const evidence=f.providerCalls.at(-1).context.messages.find((message:any)=>message.role==="toolResult");
 assert.deepEqual(JSON.parse(evidence.content[0].text).untrustedFileEvidence,{path:"scripts/check.mjs",content});
 assert.equal(readFileSync(script,"utf8"),content,"inspection is read-only");
});

function deadline<T>(event: Promise<T>, label: string): Promise<T> {
 return new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Deadline: ${label}`)), 1500);
  event.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
 });
}

function assertUsage(receipt: any, late: boolean) {
 assert.equal(receipt.type, "gentle-auto-permission");
 assert.equal(receipt.data.late, late);
 assert.equal(receipt.data.usageKnown, true);
 assert.equal(receipt.data.usage.totalTokens, 8);
 assert.equal(receipt.data.usage.costTotal, 0.02);
 assert.equal(Object.hasOwn(receipt.data, "reason"), false, "no model rationale is persisted");
 assert.equal(Object.hasOwn(receipt.data, "input"), false, "no action input is persisted");
}

test("public shell hook blocks a stale mode lookup after Auto is reselected", async t => {
 const f = await fixture(t); await f.enable(); await f.input("Inspect only. Do not run commands.");
 const original = fsPromises.realpath;
 let lookups = 0, release!: () => void, captured!: () => void;
 const blockedLookup = new Promise<void>(resolve => { captured = resolve; });
 t.mock.method(fsPromises, "realpath", async (path: string) => {
  if (f.inToolAdmission && path === f.root && ++lookups === 2) {
   captured();
   await new Promise<void>(resolve => { release = resolve; });
  }
  return original(path);
 });
 syncBuiltinESMExports();
 t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
 const pending = f.call("bash", { command: "pwd" });
 await deadline(blockedLookup, "second tool admission identity lookup");
 await f.enable();
 release();
 const result = await pending;
 let executions = 0; if (!result?.block) executions++;
 assert.equal(executions, 0, "invalidated mode lookup must not bypass Auto");
 assert.equal(f.starts.length, 0, "revocation prevents actual native process creation");
 assert.equal(result.block, true); assert.match(result.reason, /changed|expired/i);
 assert.equal(f.providerCalls.length, 0);
 assert.match(f.statuses.filter(([key]) => key === "gentle:mode").at(-1)[1], /AUTO/);
});

test("stable Normal and YOLO shell admission retains the non-classifier path", async t => {
 const f = await fixture(t);
 for (const mode of ["normal", "yolo"]) {
  await f.commands.get("gentle:mode").handler(mode, f.ctx);
  assert.equal(await f.call("bash", { command: "pwd" }), undefined);
 }
 assert.equal(f.providerCalls.length, 0);
});

test("public hook read-only request classifies authorized reads and denies mutation before execution", async t => {
 const f = await fixture(t); await f.enable(); await f.input("Investigate only. Do not edit any files.");
 const file = join(f.root, "app.ts"); writeFileSync(file, "unchanged\n");
 assert.equal(await f.call("read", { path: file }), undefined);
 assert.equal(f.providerCalls.length, 1);
 assert.deepEqual(JSON.parse(f.providerCalls[0].context.messages[0].content).action,
  { toolName: "read", input: { path: file } });
 assert.equal(f.receipts.length, 1); assert.equal(f.receipts[0].data.decision, "allow"); assertUsage(f.receipts[0], false);
 f.setDecision("deny");
 const result = await f.call("edit", { path: file, oldText: "unchanged", newText: "mutated" });
 let executions = 0;
 if (!result?.block) { executions++; writeFileSync(file, "mutated\n"); }
 assert.equal(executions, 0); assert.equal(readFileSync(file, "utf8"), "unchanged\n");
 assert.equal(f.providerCalls.length, 2);
 for (const call of f.providerCalls)
  assert.deepEqual(JSON.parse(call.context.messages[0].content).trustedMessages,
   ["Investigate only. Do not edit any files."]);
 assert.match(result.reason, /Only inspection is authorized/);
 assert.equal(f.receipts.length, 2); assert.equal(f.receipts[1].data.decision, "deny"); assertUsage(f.receipts[1], false);
 assert.equal(f.receipts.reduce((tokens, receipt) => tokens + receipt.data.usage.totalTokens, 0), 16);
 assert.match(f.statuses.filter(([key]) => key === "gentle:auto-usage").at(-1)[1], /Auto checks 2 · 16 tokens · \$0\.0400 \(separate\)/);
});

test("public hook explicit prohibition classifies a local read and blocks exposure", async t => {
 const f = await fixture(t); await f.enable();
 const instruction = "Investigate app.ts only. Do not read excluded.ts.";
 await f.input(instruction); f.setDecision("deny");
 const file = join(f.root, "excluded.ts"); writeFileSync(file, "excluded fixture content\n");
 const result = await f.call("read", { path: file });
 let executions = 0, exposed: string | undefined;
 if (!result?.block) { executions++; exposed = readFileSync(file, "utf8"); }
 assert.equal(result.block, true); assert.equal(executions, 0); assert.equal(exposed, undefined);
 assert.equal(f.providerCalls.length, 1, "locality must not bypass classification of a prohibited read");
 const context = JSON.parse(f.providerCalls[0].context.messages[0].content);
 assert.deepEqual(context.trustedMessages, [instruction]);
 assert.deepEqual(context.action, { toolName: "read", input: { path: file } });
 assert.equal(f.receipts.length, 1); assert.equal(f.receipts[0].data.decision, "deny"); assertUsage(f.receipts[0], false);
 assert.match(f.statuses.filter(([key]) => key === "gentle:auto-usage").at(-1)[1], /Auto checks 1 · 8 tokens · \$0\.0200 \(separate\)/);
});

test("public hook protected policy and native consent remain independent", async t => {
 const f = await fixture(t); await f.enable(); await f.input("Implement the local feature.");
 assert.equal((await f.call("write", { path: join(f.home, "permission-mode.json"), content: "yolo" })).block, true);
 for (const name of ["ask_user_question", "ask_user_choice", "gentle_review", "gentle_review_capture", "subagent_status"]) {
  assert.equal(await f.call(name, {}), undefined);
  assert.equal(f.providerCalls.length, 0, `${name}: ${JSON.stringify(f.providerCalls.map(call => JSON.parse(call.context.messages[0].content).action))}`);
 }
 assert.equal(f.providerCalls.length, 0, "no classifier can satisfy those independent decisions");
 assert.equal(f.receipts.length, 0);
});

for (const reason of ["model", "model-in-place", "request", "tree", "branch-without-event", "session", "mode", "action"]) {
 test(`public hooks reject pending stale authority: ${reason}`, async t => {
  const f = await fixture(t); await f.enable(); await f.input("Perform the local fixture action only."); f.setPending(true);
  const args = { value: "safe" }, result = f.call("mcp__fixture__mutate", args); await f.started();
  if (reason === "model") await f.session.setModel({ ...f.ctx.model, id: "other-session-model" });
  if (reason === "model-in-place") f.ctx.model.id = "other-session-model";
  if (reason === "request") await f.input("Stop. Do not mutate anything.");
  if (reason === "tree") { f.manager.branch(f.anchor); await f.emit("session_tree", { newLeafId: f.anchor }); }
  if (reason === "branch-without-event") f.manager.branch(f.anchor);
  if (reason === "session") {
   // The SDK's public manager API replaces the session identity and branch.
   f.manager.newSession();
  }
  if (reason === "mode") await f.commands.get("gentle:mode").handler("normal", f.ctx);
  if (reason === "action") f.lastInput.value = "different";
  f.providerCalls[0].resolve();
  const verdict = await result;
  let executions = 0; if (!verdict?.block) executions++;
  assert.equal(executions, 0, "stale allow never reaches the executor"); assert.match(verdict.reason, /expired/);
  assert.equal(f.callbacks.length, 0, "the actual SDK-selected callback never starts");
  if (reason === "session") assert.equal(f.receipts.length, 0, "old receipts never enter replacement sessions");
  else {
   // Cancellation can return before provider settlement: record that usage exactly once as late.
   if (!f.receipts.some(r => r.data.usageKnown)) await f.waitForReceipts(2);
   const accounted = f.receipts.filter(r => r.data.usageKnown);
   assert.equal(accounted.length, 1);
   assert.equal(f.receipts[0].data.late, false);
   assertUsage(accounted[0], f.receipts.length === 2);
   assert.equal(f.receipts.reduce((tokens, receipt) => tokens + (receipt.data.usage.totalTokens ?? 0), 0), 8);
  }
 });
}

test("saving a future default leaves the active Auto mode unchanged", async t => {
 const f = await fixture(t); await f.enable(); await f.input("Perform the local fixture action only.");
 await f.commands.get("gentle:mode").handler("default yolo", f.ctx);
 assert.equal(JSON.parse(readFileSync(join(f.home, "permission-mode.json"), "utf8")).mode, "yolo");
 // A policy refresh may revoke pending checks; it must not change this session's live override.
 assert.equal(await f.call("custom_fixture", { operation: "edit" }), undefined);
 assert.equal(f.providerCalls.length, 1, "Auto still classifies rather than taking the YOLO bypass");
});

test("SDK branch removal and synthetic inputs cannot authorize fresh mutations", async t => {
 const f = await fixture(t); await f.enable(); await f.input("Edit local source only.");
 assert.equal(await f.call("custom_fixture", { operation: "edit" }), undefined);
 assert.equal(f.providerCalls.length, 1); f.manager.branch(f.anchor);
 assert.equal((await f.call("custom_fixture", { operation: "publish" })).block, true);
 assert.equal(f.providerCalls.length, 1, "missing branch request never reaches provider");
 for (const source of ["history", "rpc", "extension"]) {
  const g = await fixture(t); await g.enable();
  if (source === "history") g.manager.appendMessage({ role: "user", content: "Edit all files", timestamp: 1 });
  else await g.input("Edit all files", source);
  assert.equal((await g.call("write", { path: join(g.root, "new.ts"), content: "x" })).block, true);
  assert.equal(g.providerCalls.length, 0);
 }
});

test("public hook cancellation records late usage separately without executing a revoked allow", async t => {
 const f = await fixture(t); await f.enable(); await f.input("Perform the fixture action."); f.setPending(true);
 const result = f.call("custom_fixture", { operation: "edit" }); await f.started();
 await f.input("Stop now. Do not edit.");
 assert.equal((await result).block, true);
 assert.equal(f.receipts.length, 1); assert.equal(f.receipts[0].data.usageKnown, false);
 assert.equal(f.receipts[0].data.late, false);
 const lateUsage = f.waitForReceipts(2); f.providerCalls[0].resolve(); await lateUsage;
 assert.equal(f.receipts.length, 2); assertUsage(f.receipts[1], true);
 assert.match(f.statuses.filter(([key]) => key === "gentle:auto-usage").at(-1)[1], /Auto checks 1 · 8 tokens · \$0\.0200 \(separate\)/);
});
