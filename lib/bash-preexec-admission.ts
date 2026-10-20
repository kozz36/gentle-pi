import * as sdk from "@earendil-works/pi-coding-agent";

/** Optional native API: older SDK declarations remain supported, never as a fallback. */
export interface NativeAdmissionSdk {
	bindToolExecutionContext?: (wrapper: object, delegate: object, isValid: () => boolean) => void;
}
export const nativeAdmissionSdk = sdk as typeof sdk & NativeAdmissionSdk;

export interface FinalBashPlan {
	kind: "local-bash";
	command: string;
	cwd: string;
	timeoutMs: number | undefined;
	shell: string;
	args: readonly string[];
	commandTransport: "stdin" | "argv";
}

export function finalBashPlan(value: unknown): FinalBashPlan | undefined {
	if (!value || typeof value !== "object") return undefined;
	const plan = value as Partial<FinalBashPlan>;
	return plan.kind === "local-bash" && typeof plan.command === "string" && typeof plan.cwd === "string"
		&& typeof plan.shell === "string" && Array.isArray(plan.args) && plan.args.every(arg => typeof arg === "string")
		&& (plan.timeoutMs === undefined || (typeof plan.timeoutMs === "number" && Number.isFinite(plan.timeoutMs) && plan.timeoutMs > 0))
		&& (plan.commandTransport === "stdin" || plan.commandTransport === "argv") ? plan as FinalBashPlan : undefined;
}

export function finalBashPresentation(plan: FinalBashPlan): string {
	// Preserve whitespace and the complete command, but neutralize terminal controls.
	const visible = (text: string) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
		char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
	return `Command:\n${visible(plan.command)}\n\nCwd: ${visible(plan.cwd)}\nTimeout (ms): ${plan.timeoutMs ?? "none"}\nShell: ${visible(plan.shell)}\nArgs: ${JSON.stringify(plan.args)}\nCommand transport: ${plan.commandTransport}`;
}
