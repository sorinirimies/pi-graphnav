/** `/codegraph ...`: parsing and argument completion. Pure: the handler in codegraph.ts acts on the result. */

export type Command =
	| { kind: "status" }
	| { kind: "on" }
	| { kind: "off" }
	| { kind: "level"; level: number }
	| { kind: "hello"; name: string }
	| { kind: "invalid"; message: string };

export const USAGE = "Usage: /codegraph [status] · on · off · level <1-100> · hello [name]";

export function parseCommand(args: string | undefined): Command {
	const [cmd, ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
	switch (cmd?.toLowerCase()) {
		case undefined:
		case "status":
			return { kind: "status" };
		case "on":
		case "enable":
			return { kind: "on" };
		case "off":
		case "disable":
			return { kind: "off" };
		case "level": {
			const n = Number(rest[0]);
			return Number.isInteger(n) && n >= 1 && n <= 100
				? { kind: "level", level: n }
				: { kind: "invalid", message: "Usage: /codegraph level <1-100>" };
		}
		case "hello":
			return { kind: "hello", name: rest.join(" ") };
		default:
			return { kind: "invalid", message: `Unknown option "${cmd}". ${USAGE}` };
	}
}

export interface CompletionItem {
	value: string;
	/** Required by pi: it calls `label.endsWith(...)` when applying a completion. */
	label: string;
	description?: string;
}

const TOP_LEVEL: CompletionItem[] = [
	{ value: "status", label: "status", description: "Show the settings" },
	{ value: "on", label: "on", description: "Turn CodeGraph on" },
	{ value: "off", label: "off", description: "Turn CodeGraph off" },
	{ value: "level ", label: "level", description: "Set the level (1 to 100)" },
	{ value: "hello", label: "hello", description: "Say hello (sample)" },
];

/** `prefix` is the whole argument text typed so far (pi replaces it with `value`). */
export function completions(prefix: string): CompletionItem[] | null {
	const text = (prefix ?? "").toLowerCase().replace(/^\s+/, "");
	const out = TOP_LEVEL.filter((i) => i.value.startsWith(text));
	return out.length > 0 ? out : null;
}
