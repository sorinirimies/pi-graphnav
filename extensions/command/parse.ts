/** `/codegraph ...`: parsing and argument completion. Pure: the handler in graphnav.ts acts on the result. */
import { MODES, type Mode, STATUS_SHOWS, type StatusShow } from "../core/config.ts";

export type Command =
	| { kind: "status" }
	| { kind: "on" }
	| { kind: "off" }
	| { kind: "mode"; mode: Mode }
	| { kind: "statusline"; show: StatusShow }
	| { kind: "sync" }
	| { kind: "reindex" }
	| { kind: "init" }
	| { kind: "invalid"; message: string };

export const USAGE = "Usage: /codegraph [status] · on · off · mode <enforce|nudge|off> · statusline <always|problems|never> · sync · reindex · init";

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
		case "mode": {
			const m = rest[0]?.toLowerCase();
			return MODES.includes(m as Mode) && rest.length === 1
				? { kind: "mode", mode: m as Mode }
				: { kind: "invalid", message: "Usage: /codegraph mode <enforce|nudge|off>" };
		}
		case "statusline": {
			const v = rest[0]?.toLowerCase();
			return STATUS_SHOWS.includes(v as StatusShow) && rest.length === 1
				? { kind: "statusline", show: v as StatusShow }
				: { kind: "invalid", message: "Usage: /codegraph statusline <always|problems|never>" };
		}
		case "sync":
			return { kind: "sync" };
		case "reindex":
		case "index":
			return { kind: "reindex" };
		case "init":
			return { kind: "init" };
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
	{ value: "status", label: "status", description: "Index state, mode and gate counts" },
	{ value: "on", label: "on", description: "Turn CodeGraph-first on" },
	{ value: "off", label: "off", description: "Turn CodeGraph-first off" },
	{ value: "mode ", label: "mode", description: "Symbol searches: enforce, nudge or off" },
	{ value: "statusline ", label: "statusline", description: "Status line: always, only problems, or never" },
	{ value: "sync", label: "sync", description: "Sync the index with changed files" },
	{ value: "reindex", label: "reindex", description: "Rebuild the index from scratch" },
	{ value: "init", label: "init", description: "Create the index for this project" },
];

const MODE_ITEMS: CompletionItem[] = [
	{ value: "mode enforce", label: "enforce", description: "Block a symbol search once, pointing to CodeGraph" },
	{ value: "mode nudge", label: "nudge", description: "Let it run, add a CodeGraph hint to the result" },
	{ value: "mode off", label: "off", description: "Leave text searches alone" },
];

const STATUSLINE_ITEMS: CompletionItem[] = [
	{ value: "statusline always", label: "always", description: "Always show the CodeGraph status" },
	{ value: "statusline problems", label: "problems", description: "Only while indexing, or when the index is missing, failing or unavailable" },
	{ value: "statusline never", label: "never", description: "Never show it (CodeGraph keeps working)" },
];

/** `prefix` is the whole argument text typed so far (pi replaces it with `value`). */
export function completions(prefix: string): CompletionItem[] | null {
	const text = (prefix ?? "").toLowerCase().replace(/^\s+/, "");
	const pool = text.startsWith("mode ") ? MODE_ITEMS : text.startsWith("statusline ") ? STATUSLINE_ITEMS : TOP_LEVEL;
	const out = pool.filter((i) => i.value.startsWith(text));
	return out.length > 0 ? out : null;
}
