/** A fake `pi` and command context, so tests drive the extension the way pi would. */
import { createExtension, type Deps } from "../extensions/graphnav.ts";

type Handler = (event: any, ctx: any) => Promise<any> | any;
export type Command = {
	description: string;
	handler: (args: string, ctx: any) => Promise<void>;
	getArgumentCompletions: (p: string) => { value: string; label: string }[] | null;
};
export type Tool = {
	name: string;
	label: string;
	description: string;
	promptSnippet: string;
	parameters: unknown;
	execute: (id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: unknown, ctx: { cwd: string }) => Promise<any>;
};

export function load(deps?: Deps) {
	const hooks: Record<string, Handler> = {};
	const commands: Record<string, Command> = {};
	const tools: Record<string, Tool> = {};
	createExtension(deps)({
		on: (n: string, h: Handler) => (hooks[n] = h),
		registerCommand: (n: string, c: Command) => (commands[n] = c),
		registerTool: (t: Tool) => (tools[t.name] = t),
	} as any);
	return { hooks, commands, tools };
}

/** A context that records notifications and the status line. */
export function fakeCtx(cwd: string = process.cwd()) {
	const notes: [string, string][] = [];
	const status: Record<string, string> = {};
	return {
		cwd,
		notes,
		status,
		ui: {
			notify: (m: string, level: string) => notes.push([m, level]),
			setStatus: (k: string, t: string) => (status[k] = t),
		},
	};
}
