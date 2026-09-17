import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sddInit from "../extensions/sdd-init.ts";

interface RegisteredCommand {
	description: string;
	handler: (args: unknown, ctx: unknown) => Promise<void>;
}

function commandHarness(): RegisteredCommand {
	let command: RegisteredCommand | undefined;
	sddInit({
		registerCommand(name: string, candidate: RegisteredCommand) {
			assert.equal(name, "gentle-sdd-init");
			command = candidate;
		},
	} as never);
	assert.ok(command);
	return command;
}

async function withProject(
	run: (project: string, notices: string[]) => Promise<void>,
): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "gentle-sdd-init-policy-"));
	const project = join(root, "project");
	const agentHome = join(root, "agent-home");
	mkdirSync(project, { recursive: true });
	const previous = process.env.GENTLE_PI_AGENT_HOME;
	try {
		process.env.GENTLE_PI_AGENT_HOME = agentHome;
		const notices: string[] = [];
		await run(project, notices);
	} finally {
		if (previous === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = previous;
		rmSync(root, { recursive: true, force: true });
	}
}

test("gentle-sdd-init reports detected capabilities but never derives or writes TDD policy", async () => {
	await withProject(async (project, notices) => {
		writeFileSync(join(project, "package.json"), JSON.stringify({
			name: "detected-project",
			scripts: { test: "node --test" },
		}));
		const command = commandHarness();
		await command.handler("", {
			cwd: project,
			hasUI: false,
			mode: "print",
			ui: { notify: (message: string) => notices.push(message) },
		});

		assert.equal(existsSync(join(project, "openspec", "config.yaml")), false);
		assert.ok(notices.some((notice) => /detected.*Node\.js\/TypeScript/i.test(notice)));
		assert.ok(notices.some((notice) => /approved neutral policy/i.test(notice)));
		assert.ok(notices.every((notice) => !/strict TDD (?:enabled|disabled)/i.test(notice)));
	});
});

test("gentle-sdd-init preserves an existing OpenSpec policy byte-for-byte", async () => {
	await withProject(async (project, notices) => {
		const configPath = join(project, "openspec", "config.yaml");
		mkdirSync(join(project, "openspec"), { recursive: true });
		const approved = "strict_tdd: true\ntesting:\n  runner:\n    command: custom-test\n";
		writeFileSync(configPath, approved);
		const command = commandHarness();
		await command.handler("", {
			cwd: project,
			hasUI: false,
			mode: "print",
			ui: { notify: (message: string) => notices.push(message) },
		});

		assert.equal(readFileSync(configPath, "utf8"), approved);
		assert.ok(notices.some((notice) => /existing neutral policy projection[\s\S]*approval must be verified by parent/i.test(notice)));
	});
});
