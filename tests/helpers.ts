/** A fake `pi` and command context, so tests drive the extension the way pi would. */
import ext from "../extensions/codegraph.ts";

type Handler = (event: any, ctx: any) => Promise<any> | any;
export type Command = { description: string; handler: (args: string, ctx: any) => Promise<void>; getArgumentCompletions: (p: string) => { value: string; label: string }[] | null };

export function load() {
	const hooks: Record<string, Handler> = {};
	const commands: Record<string, Command> = {};
	ext({ on: (n: string, h: Handler) => (hooks[n] = h), registerCommand: (n: string, c: Command) => (commands[n] = c) } as any);
	return { hooks, commands };
}

/** A context that records notifications and the status line. */
export function fakeCtx() {
	const notes: [string, string][] = [];
	const status: Record<string, string> = {};
	return {
		notes,
		status,
		ui: {
			notify: (m: string, level: string) => notes.push([m, level]),
			setStatus: (k: string, t: string) => (status[k] = t),
		},
	};
}
