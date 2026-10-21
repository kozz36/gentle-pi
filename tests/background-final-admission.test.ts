import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ToolExecutionDecision } from "@earendil-works/pi-agent-core";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBackgroundAdmissionFixture, observeNativeStarts } from "./support/background-final-admission.ts";

test("registered bash_background admits and acknowledges one actual native start", { timeout: 10_000 }, async t => {
	const cwd = mkdtempSync(join(tmpdir(), "background-final-"));
	const fixture = await createBackgroundAdmissionFixture(cwd);
	const observer = observeNativeStarts();
	try {
		const before = await fixture.dispatch("job_list", {});
		assert.equal(before.isError, false);
		assert.deepEqual(before.result.content, [{ type: "text", text: "No background jobs in this session." }]);
		const outcome = await fixture.dispatch("bash_background", { command: "printf background-executor-probe" }, true);
		const after = await fixture.dispatch("job_list", {});
		const observation = {
			isError: outcome.isError, result: outcome.result, osStarts: observer.count(), jobList: after.result.content,
			counters: { ...fixture.counters }, outputFiles: readdirSync(fixture.outputDir),
			running: fixture.registry.running(), pending: fixture.registry.pending(), settled: fixture.settled.length,
		};
		t.diagnostic(JSON.stringify(observation));
		assert.equal(outcome.isError, false, `Expected admitted background acknowledgement; observed ${JSON.stringify(observation)}`);
		assert.equal(observer.count(), 1, "one actual OS process starts before acknowledgement");
		assert.match(JSON.stringify(outcome.result.content), /Started background job/);
		assert.match(JSON.stringify(after.result.content), /job-1/);
		await fixture.waitForSettled(1);
		await observer.closed();
		assert.deepEqual(observer.actual, [{ stdout: "background-executor-probe", stderr: "", exitCode: 0 }]);
	} finally {
		await fixture.registry.stopAll();
		observer.restore();
	}
});

test("acknowledged background and monitor jobs outlive caller cancellation", { timeout: 10_000 }, async () => {
	for (const tool of ["bash_background", "monitor"]) {
		const cwd = mkdtempSync(join(tmpdir(), "background-after-ack-"));
		const fixture = await createBackgroundAdmissionFixture(cwd);
		const observer = observeNativeStarts();
		const controller = new AbortController();
		try {
			const outcome = await fixture.dispatch(tool, {
				command: "while [ ! -f release ]; do :; done; printf 'survived\\n'",
				...(tool === "monitor" ? { timeout_seconds: 2 } : {}),
			}, true, controller.signal);
			assert.equal(outcome.isError, false, JSON.stringify(outcome.result));
			assert.match(JSON.stringify(outcome.result.content), /job-1/);
			assert.equal(observer.count(), 1);
			assert.equal(fixture.settled.length, 0, "the acknowledged command is still running");
			const running = await fixture.dispatch("job_list", {});
			assert.match(JSON.stringify(running.result.content), /running/);
			controller.abort();
			writeFileSync(join(cwd, "release"), "", { mode: 0o600 });
			await fixture.waitForSettled(1);
			await observer.closed();
			assert.deepEqual(observer.actual, [{ stdout: "survived\n", stderr: "", exitCode: 0 }]);
			const finished = await fixture.dispatch("job_list", {});
			assert.equal(finished.isError, false);
			assert.match(JSON.stringify(finished.result.content), /exited/);
			assert.deepEqual(readdirSync(fixture.outputDir), ["job-1.log"]);
			assert.equal(readFileSync(join(fixture.outputDir, "job-1.log"), "utf8"), "survived\n");
			assert.deepEqual(fixture.counters, { shell: 0, outputDir: 1, clock: 2, changed: 1 });
		} finally {
			writeFileSync(join(cwd, "release"), "", { mode: 0o600 });
			fixture.monitors.cancelAll();
			await fixture.registry.stopAll();
			observer.restore();
		}
	}
});

for (const tool of ["bash_background", "monitor"]) {
	for (const mode of ["deny", "confirmation-denied", "cancelled", "replaced"] as const) {
		test(`${tool}: pending ${mode} publishes no jobs, files, ids or process`, { timeout: 10_000 }, async t => {
			const cwd = mkdtempSync(join(tmpdir(), "background-deny-"));
			const fixture = await createBackgroundAdmissionFixture(cwd);
			const observer = observeNativeStarts();
			const controller = new AbortController();
			let enter!: () => void;
			const entered = new Promise<void>(resolve => { enter = resolve; });
			let release!: (decision: ToolExecutionDecision) => void;
			const decision = new Promise<ToolExecutionDecision>(resolve => { release = resolve; });
			let evaluated = false;
			const args = { command: "printf forbidden > effect", ...(tool === "monitor" ? { timeout_seconds: 2 } : {}) };
			try {
				const pending = fixture.dispatch(tool, args, {
					isValid: () => true,
					evaluate: plan => {
						evaluated = true;
						assert.equal(Object.isFrozen(plan), true);
						assert.match(JSON.stringify(plan), /# native background fixture/);
						enter(); return decision;
					},
					approve: async () => false,
				}, controller.signal);
				await Promise.race([entered, pending]);
				assert.equal(evaluated, true, JSON.stringify(await Promise.race([pending, Promise.resolve("no final plan")])));
				const empty = await fixture.dispatch("job_list", {});
				assert.deepEqual(empty.result.content, [{ type: "text", text: "No background jobs in this session." }]);
				assert.equal(observer.count(), 0);
				assert.equal(readdirSync(cwd).includes("effect"), false);
				assert.deepEqual(readdirSync(fixture.outputDir), []);
				assert.equal(fixture.counters.clock, 0);
				assert.equal(fixture.counters.changed, 0);
				if (mode === "cancelled") controller.abort();
				if (mode === "replaced") {
					const registered = fixture.tools.find(entry => entry.name === tool)!;
					registered.execute = async () => { throw new Error("Replacement must not run"); };
				}
				release(mode === "deny" ? "deny" : mode === "confirmation-denied" ? "confirm" : "allow");
				const outcome = await pending;
				t.diagnostic(JSON.stringify(outcome.result));
				assert.equal(outcome.isError, true);
				assert.match(JSON.stringify(outcome.result.content), mode === "deny" ? /Final execution policy denied/
					: mode === "confirmation-denied" ? /Tool execution admission denied/ : /stale or cancelled/);
				assert.equal(observer.count(), 0);
				assert.equal(observer.actual.length, 0);
				assert.deepEqual(readdirSync(fixture.outputDir), []);
				assert.equal(fixture.counters.clock, 0);
				assert.equal(fixture.counters.changed, 0);
				const after = await fixture.dispatch("job_list", {});
				assert.deepEqual(after.result.content, empty.result.content);
				// The next admitted call still receives the first public id.
				if (mode !== "replaced") {
					const allowed = await fixture.dispatch(tool, { command: "printf next", ...(tool === "monitor" ? { timeout_seconds: 2 } : {}) }, true);
					assert.equal(allowed.isError, false);
					assert.match(JSON.stringify(allowed.result.content), /job-1/);
					await fixture.waitForSettled(1);
					await observer.closed();
					assert.deepEqual(observer.actual, [{ stdout: "next", stderr: "", exitCode: 0 }]);
				}
			} finally {
				release("deny"); fixture.monitors.cancelAll();
				await fixture.registry.stopAll(); observer.restore();
			}
		});
	}
}

test("monitor and background reused ids isolate concurrent starts and return before completion", { timeout: 10_000 }, async () => {
	const cwd = mkdtempSync(join(tmpdir(), "background-concurrent-"));
	const fixture = await createBackgroundAdmissionFixture(cwd);
	const observer = observeNativeStarts();
	try {
		const commands = ["while [ ! -f release ]; do :; done; printf 'background\\n'; printf err >&2; exit 3", "while [ ! -f release ]; do :; done; printf 'monitor\\n'"];
		const outcomes = await Promise.all([
			fixture.dispatch("bash_background", { command: commands[0] }, true),
			fixture.dispatch("monitor", { command: commands[1], timeout_seconds: 2 }, true),
		]);
		assert.ok(outcomes.every(outcome => !outcome.isError), JSON.stringify(outcomes));
		assert.equal(observer.count(), 2);
		assert.equal(fixture.settled.length, 0, "acknowledgement precedes controlled completion");
		const listing = await fixture.dispatch("job_list", {});
		assert.match(JSON.stringify(listing.result.content), /job-1/);
		assert.match(JSON.stringify(listing.result.content), /job-2/);
		writeFileSync(join(cwd, "release"), "", { mode: 0o600 });
		await fixture.waitForSettled(2);
		await observer.closed();
		assert.deepEqual(observer.actual.map(row => row.exitCode).sort(), [0, 3]);
		for (const job of fixture.settled) {
			assert.equal(job.status, "exited");
			const output = readFileSync(job.outputPath, "utf8");
			assert.equal(output, job.kind === "monitor" ? "monitor\n" : "background\nerr");
		}
		assert.ok(fixture.monitorsNotices.some(notice => JSON.stringify(notice).includes("monitor")));
		const stopped = await fixture.dispatch("job_stop", { job_id: "job-1" });
		assert.equal(stopped.isError, false);
		assert.match(JSON.stringify(stopped.result.content), /already exited/);
	} finally {
		fixture.monitors.cancelAll(); await fixture.registry.stopAll(); observer.restore();
	}
});

test("replacing a forwarding method while admission waits invalidates its native binding", { timeout: 10_000 }, async () => {
	const cwd = mkdtempSync(join(tmpdir(), "background-forwarding-"));
	const fixture = await createBackgroundAdmissionFixture(cwd);
	const observer = observeNativeStarts();
	let enter!: () => void;
	const entered = new Promise<void>(resolve => { enter = resolve; });
	let release!: () => void;
	const approved = new Promise<void>(resolve => { release = resolve; });
	try {
		const pending = fixture.dispatch("bash_background", { command: "printf unchanged" }, {
			isValid: () => true,
			evaluate: async (): Promise<ToolExecutionDecision> => { enter(); await approved; return "allow"; },
			approve: async () => false,
		});
		await entered;
		fixture.registry.startAdmitted = async () => { throw new Error("Replaced forwarding method must not run"); };
		release();
		const outcome = await pending;
		assert.equal(outcome.isError, true);
		assert.match(JSON.stringify(outcome.result.content), /stale or cancelled/);
		assert.equal(observer.count(), 0);
		assert.deepEqual(readdirSync(fixture.outputDir), []);
	} finally {
		release(); await fixture.registry.stopAll(); observer.restore();
	}
});
