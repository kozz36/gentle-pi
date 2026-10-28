import { observeNativeAdmissions, type AdmissionObservation, createNativeSession, sdk, createGentleAiExtension, fauxAssistantMessage, fauxToolCall } from "./support/bash-preexec-fixture.ts";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createChildSafetyExtension } from "../extensions/child-safety.ts";

type Handler = (event: { toolName: string; input: { command: string } }, ctx: ExtensionContext) => unknown;
async function harness(t: test.TestContext, child: boolean, primary = false) {
	const root = mkdtempSync(join(tmpdir(), "child-native-"));
	mkdirSync(join(root, "data"));
	const sentinel = join(root, "data", "owned-counter");
	writeFileSync(sentinel, "unchanged");
	const handlers: Handler[] = [];
	const admissions: AdmissionObservation[] = [];
	const events: Array<{ name: string; data: unknown }> = [];
	const env = { ...process.env, GENTLE_PI_AGENTS_CHILD: child ? "1" : "0" };
	const native = await createNativeSession({ cwd: root, tools: ["*"], extensionFactories: [pi => {
		for (const name of ["pi-permission-system:permission-request", "herdr:blocked"]) pi.events.on(name, data => events.push({ name, data }));
		const observed = new Proxy(observeNativeAdmissions(pi, admissions), { get(target, key) {
			if (key === "on") return (name: string, handler: Handler) => {
				if (name === "tool_call") handlers.push(handler);
				return target.on(name as never, handler as never);
			};
			return Reflect.get(target, key);
		} });
		if (primary) createGentleAiExtension({ processEnv: env, nativeReviewCli: null })(observed);
		else createChildSafetyExtension(env)(observed);
		// These aliases retain the canonical SDK execute and its actual native backend binding.
		for (const name of ["bash_background", "monitor"]) pi.registerTool({ ...sdk.createBashToolDefinition(root, { requireAdmission: true, shellPath: "/bin/sh" }), name });
	}] });
	t.after(() => { native.session.dispose(); rmSync(root, { recursive: true, force: true }); });
	await native.session.bindExtensions({ mode: "tui", uiContext: new Proxy({}, { get: () => () => {} }) });
	const observations: Array<{ callbacks: number; attempts: number; result: unknown }> = [];
	const fixture = { events, observations, sentinel,
		async call(input: Parameters<Handler>[0], control: ExtensionContext) {
			let dialogError: unknown;
			const ui = new Proxy({ confirm: async (title: string, preview: string) => {
				try { return await control.ui.confirm(title, preview); }
				catch (error) { dialogError = error; throw error; }
			} }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
			native.session.extensionRunner.setUIContext(control.hasUI ? ui : undefined, "tui");
			const outcomes: Array<{ isError: boolean; result: { content: Array<{ type: string; text?: string }> } }> = [];
			const admissionStart = admissions.length;
			let admissionEnd: number | undefined;
			let legacyProgress = 0;
			const observation = { get callbacks() { return admissions.slice(admissionStart, admissionEnd).filter(entry => entry.method === "evaluate").length; }, attempts: 0, result: undefined as unknown };
			observations.push(observation);
			const attempts: Parameters<typeof childProcess.spawn>[] = [];
			const unsubscribe = native.session.subscribe((event: any) => {
				if (event.type === "tool_execution_update" && event.partialResult.content.length === 0) legacyProgress++;
				if (event.type === "tool_execution_end") outcomes.push(event);
			});
			const originalSpawn = childProcess.spawn;
			const stopped = "Child fixture categorically stopped OS process creation";
			childProcess.spawn = ((...args: Parameters<typeof originalSpawn>) => { attempts.push(args); observation.attempts = attempts.length; throw new Error(stopped); }) as unknown as typeof originalSpawn;
			syncBuiltinESMExports();
			native.faux.setResponses([fauxAssistantMessage([fauxToolCall(input.toolName, input.input)], { stopReason: "toolUse" }), fauxAssistantMessage("done")]);
			try { await native.session.agent.prompt({ role: "user", content: "Check only the owned native admission fixture.", timestamp: 1 }); }
			finally { admissionEnd = admissions.length; unsubscribe(); childProcess.spawn = originalSpawn; syncBuiltinESMExports(); }
			assert.equal(outcomes.length, 1);
			assert.equal(legacyProgress, !primary && attempts.length ? 1 : 0, "standalone child safety supplies no native binding for harmless commands; primary uses native admission");
			const callbacks = observation.callbacks;
			const visits = admissions.slice(admissionStart);
			assert.equal(visits.filter(entry => entry.method === "approve").length, !child && control.hasUI ? 1 : 0, "only interactive primary confirmation invokes approval; Core refuses missing UI first");
			assert.equal(readFileSync(sentinel, "utf8"), "unchanged");
			const outcome = outcomes[0];
			const reason = outcome.result.content.map(block => block.text ?? "").join("\n");
			observation.result = outcome;
			if (dialogError) { assert.equal(attempts.length, 0); assert.match(reason, /cancelled dialog/); throw dialogError; }
			if (attempts.length) {
				assert.equal(attempts.length, 1); assert.equal(callbacks, primary ? 1 : 0, "standalone child guard returns no admission policy for harmless commands");
				assert.equal((attempts[0][1] as string[]).at(-1), input.input.command);
				assert.equal((attempts[0][2] as { cwd: string }).cwd, root);
				assert.equal(outcome.isError, true); assert.equal(reason, stopped);
				// Admission reached the real final native boundary; no hazardous OS process ran.
				return undefined;
			}
			assert.equal(outcome.isError, true, "unbound or denied calls must not look admitted");
			if (child) {
				assert.equal(callbacks, 0);
				assert.equal(reason, "Gentle AI child safety blocked a recognized destructive command. Return an explicit safer plan to the parent; children cannot authorize data loss.");
			} else {
				assert.equal(reason, control.hasUI ? "Tool execution admission denied" : "Final admission requires UI context");
			}
			return { block: true, reason };
		},
	};
	// Preserve the old call-shaped fixture interface, not its early-hook execution.
	return { ...fixture, handlers: handlers.map(() => fixture.call) };
}
const context = (confirm: (title: string, preview: string) => Promise<boolean>, hasUI = true) => ({ cwd: process.cwd(), hasUI, ui: { confirm } }) as unknown as ExtensionContext;
const event = (command: string) => ({ toolName: "bash", input: { command } });

test("child-only safety is inert in primary auto-discovery", async t => {
	assert.equal((await harness(t, false)).handlers.length, 0);
});

test("children block recognized data loss and destructive git even with UI", async t => {
	for (const primary of [false, true]) {
		const h = await harness(t, true, primary);
		for (const command of [
			`psql -c 'DROP TABLE users'`, `mysql -e 'TRUNCATE TABLE users'`,
			`sqlite3 app.db 'DELETE FROM users'`, `echo ok && rm -rf ./data`,
			`find ./data -delete`, `sh -c 'git -C /repo reset --hard'`,
			`git restore .`, `git branch -D old`, `git push -f`, `git clean -fd`,
			`git rebase main`, `git checkout -- .`, `git stash clear`,
		]) {
			const result = await h.handlers[0](event(command), context(async () => { throw new Error("child must never prompt"); }));
			assert.equal((result as { block?: boolean })?.block, true, command);
		}
		assert.equal(await h.handlers[0](event("pnpm test"), context(async () => false, false)), undefined);
	}
});

test("headless children reject corrected literal forms without prompting", async t => {
	for (const primary of [false, true]) {
		const h = await harness(t, true, primary);
		const ctx = context(async () => { throw new Error("headless child must never prompt"); }, false);
		for (const command of [
			`git push ';' -f main`, `rm -r ';' /`,
			String.raw`sh -c "psql -c \"DROP TABLE users\""`,
			`psql -c 'DELETE FROM "where"'`,
			String.raw`find cache -exec echo {} \; -exec rm -r {} \;`,
			`sudo -n rm -r ./data`, `command -p psql -c 'DROP TABLE users'`,
		]) {
			assert.equal((await h.handlers[0](event(command), ctx) as { block?: boolean })?.block, true, command);
		}
		assert.equal(await h.handlers[0](event(`printf '%s ' ';' rm -r ./data`), ctx), undefined);
	}
});

// gentle-pi#2285: removal behind reserved words, in backticks or in eval is still data loss.
test("children block destruction after reserved words, in backticks and in eval", async t => {
	for (const primary of [false, true]) {
		const h = await harness(t, true, primary);
		const ctx = context(async () => { throw new Error("child must never prompt"); }, false);
		for (const command of [
			`if true; then rm -rf data; fi`, `for d in a b; do rm -rf "$d"; done`, "echo `rm -rf data`", `eval 'rm -rf data'`,
			`if true; then rm -rf ~; fi`, `{ rm -rf data; }`, `while true; do rm -rf data; done`,
		]) {
			assert.equal((await h.handlers[0](event(command), ctx) as { block?: boolean })?.block, true, command);
		}
		for (const command of [`if [ -f x ]; then echo ok; fi`, `for f in *; do cat "$f"; done`, "echo `date`", `grep "then rm -rf" x`]) {
			assert.equal(await h.handlers[0](event(command), ctx), undefined, command);
		}
	}
});

test("primary requires fresh confirmation, cancellation and missing UI block", async t => {
	const h = await harness(t, false, true);
	const command = `psql -c 'DROP TABLE users'`;
	let prompts = 0;
	const ctx = context(async (title, preview) => {
		assert.equal(title, "Allow recognized data-loss command?");
		assert.match(preview, /DROP TABLE users/);
		prompts++;
		return true;
	});
	assert.equal(await h.handlers[0](event(command), ctx), undefined);
	assert.equal(await h.handlers[0](event(command), ctx), undefined);
	assert.equal(prompts, 2, "approval is never cached");
	assert.deepEqual(h.observations.map(({ callbacks, attempts }) => ({ callbacks, attempts })), [{ callbacks: 1, attempts: 1 }, { callbacks: 1, attempts: 1 }]);
	assert.equal((await h.handlers[0](event(command), context(async () => false)) as { block: boolean }).block, true);
	const eventsBeforeHeadless = h.events.slice();
	const headless = await h.handlers[0](event(command), context(async () => { throw new Error("no UI"); }, false));
	assert.deepEqual(headless, { block: true, reason: "Final admission requires UI context" });
	assert.deepEqual(h.events, eventsBeforeHeadless, "Core refuses before approve, so headless execution emits no waiting/denied or Herdr lifecycle events");
	assert.equal(h.observations.at(-1)?.callbacks, 1, "headless policy is still evaluated once");
	assert.equal(h.observations.at(-1)?.attempts, 0, "headless refusal never attempts an OS process");
	assert.equal(readFileSync(h.sentinel, "utf8"), "unchanged");
	await assert.rejects(async () => h.handlers[0](event(command), context(async () => { throw new Error("cancelled dialog"); })), /cancelled dialog/);
	assert.deepEqual(h.observations.slice(2).map(({ callbacks, attempts }) => ({ callbacks, attempts })), [{ callbacks: 1, attempts: 0 }, { callbacks: 1, attempts: 0 }, { callbacks: 1, attempts: 0 }]);
	const states = h.events.filter((entry) => entry.name === "pi-permission-system:permission-request").map((entry) => (entry.data as { state: string }).state);
	assert.deepEqual(states, ["waiting", "approved", "waiting", "approved", "waiting", "denied", "waiting", "denied"]);
	const blockers = h.events.filter((entry) => entry.name === "herdr:blocked").map((entry) => (entry.data as { active: boolean }).active);
	assert.deepEqual(blockers, [true, false, true, false, true, false, true, false]);
});

test("primary native admission stays pending without OS creation or effects", async t => {
	const h = await harness(t, false, true);
	let entered!: () => void;
	let release!: (answer: boolean) => void;
	const waiting = new Promise<void>(resolve => { entered = resolve; });
	const pending = h.call(event("psql -c 'DROP TABLE users'"), context(async () => {
		const answer = new Promise<boolean>(resolve => { release = resolve; }); entered(); return answer;
	}));
	try {
		await Promise.race([waiting, pending.then(() => { throw new Error("Native admission ended before confirmation"); })]);
		assert.equal(h.observations.at(-1)?.callbacks, 1);
		assert.equal(h.observations.at(-1)?.attempts, 0);
		assert.equal(readFileSync(h.sentinel, "utf8"), "unchanged");
		release(false);
		assert.equal((await pending)?.block, true);
		assert.equal(h.observations.at(-1)?.attempts, 0);
	} finally { release?.(false); await pending; }
});

// The YOLO temp-scratch waiver is primary-only: children still block it and
// Normal mode still asks, whatever the targets look like on disk.
test("temp scratch removal stays blocked in children and confirmed in Normal mode", async t => {
	const scratch = mkdtempSync(join(tmpdir(), "tmp."));
	try {
		const command = `rm -rf ${scratch} /tmp/tmp.8phya1BpFr /tmp/ctx-backstop-pnpm-test.log; cd /tmp && git log --oneline -1`;
		for (const primary of [false, true]) {
			const result = await (await harness(t, true, primary)).handlers[0](event(command), context(async () => { throw new Error("child must never prompt"); }));
			assert.equal((result as { block?: boolean })?.block, true, `child via ${primary ? "primary" : "safety"} entry`);
		}
		const titles: string[] = [];
		const normal = await harness(t, false, true);
		assert.equal(await normal.handlers[0](event(command), context(async (title) => { titles.push(title); return true; })), undefined);
		assert.deepEqual(titles, ["Allow recognized data-loss command?"]);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});

test("children block recognized destructive commands sent to bash_background too", async t => {
	const h = await harness(t, true);
	const result = await h.handlers[0]({ toolName: "bash_background", input: { command: "echo ok && rm -rf ./data" } }, context(async () => { throw new Error("child must never prompt"); }));
	assert.equal((result as { block?: boolean })?.block, true);
});

test("children block recognized destructive commands sent to monitor too", async t => {
	const h = await harness(t, true);
	const result = await h.handlers[0]({ toolName: "monitor", input: { command: "echo ok && rm -rf ./data" } }, context(async () => { throw new Error("child must never prompt"); }));
	assert.equal((result as { block?: boolean })?.block, true);
});
