/**
 * The `codegraph_*` tools: names, parameters and the guidance the model sees.
 *
 * The names match the CodeGraph MCP server's tools, so calls pass straight through.
 */
import { Type } from "typebox";

const projectPath = Type.Optional(
	Type.String({ description: "Absolute path of another indexed project. Defaults to the current project." }),
);

const kind = Type.Optional(
	Type.Union(
		["function", "method", "class", "interface", "type", "variable", "route", "component"].map((k) => Type.Literal(k)),
		{ description: "Only symbols of this kind." },
	),
);

export const TOOLS = [
	{
		name: "codegraph_explore",
		label: "CodeGraph Explore",
		description:
			"Start here for any question about how code works, where something lives or what to change: returns the source of the relevant symbols, grouped by file, with the call paths between them. Accepts symbol names, file names or plain code terms.",
		snippet: "Explore an area of the codebase: relevant symbols' source and call paths in one call",
		parameters: Type.Object({
			query: Type.String({ description: "Symbols, files or code terms, e.g. \"parseConfig loadSettings\"." }),
			maxFiles: Type.Optional(Type.Number({ description: "Most files to return (default 12)." })),
			projectPath,
		}),
	},
	{
		name: "codegraph_search",
		label: "CodeGraph Search",
		description: "Find symbols by name (or part of one): kind, file and line of each definition. Use instead of grep for a symbol.",
		snippet: "Find where a symbol is defined (instead of rg/grep)",
		parameters: Type.Object({
			query: Type.String({ description: "Symbol name or part of one." }),
			kind,
			limit: Type.Optional(Type.Number({ description: "Most results (default 10)." })),
			projectPath,
		}),
	},
	{
		name: "codegraph_node",
		label: "CodeGraph Node",
		description: "One symbol in detail: signature, location, callers and callees; with includeCode its source.",
		snippet: "One symbol's details, callers and callees",
		parameters: Type.Object({
			symbol: Type.String({ description: "Symbol name." }),
			includeCode: Type.Optional(Type.Boolean({ description: "Include the source (default false)." })),
			projectPath,
		}),
	},
	{
		name: "codegraph_callers",
		label: "CodeGraph Callers",
		description: "Every function or method that calls a symbol: its usages, without grepping.",
		snippet: "Who calls a symbol (its usages)",
		parameters: Type.Object({
			symbol: Type.String({ description: "Symbol name." }),
			limit: Type.Optional(Type.Number({ description: "Most results (default 20)." })),
			projectPath,
		}),
	},
	{
		name: "codegraph_callees",
		label: "CodeGraph Callees",
		description: "Every function or method a symbol calls.",
		snippet: "What a symbol calls",
		parameters: Type.Object({
			symbol: Type.String({ description: "Symbol name." }),
			limit: Type.Optional(Type.Number({ description: "Most results (default 20)." })),
			projectPath,
		}),
	},
	{
		name: "codegraph_impact",
		label: "CodeGraph Impact",
		description: "What a change to a symbol affects, transitively. Call it before changing a signature or behaviour.",
		snippet: "What breaks if a symbol changes",
		parameters: Type.Object({
			symbol: Type.String({ description: "Symbol name." }),
			depth: Type.Optional(Type.Number({ description: "How many levels to follow (default 2)." })),
			projectPath,
		}),
	},
	{
		name: "codegraph_files",
		label: "CodeGraph Files",
		description: "The project's indexed files as a tree, flat list or grouped by language, with symbol counts.",
		snippet: "Project file structure from the index",
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Only files under this root-relative prefix, e.g. \"src/core\"." })),
			pattern: Type.Optional(Type.String({ description: "Glob on file paths, e.g. \"*.test.ts\"." })),
			format: Type.Optional(Type.Union([Type.Literal("tree"), Type.Literal("flat"), Type.Literal("grouped")])),
			includeMetadata: Type.Optional(Type.Boolean()),
			maxDepth: Type.Optional(Type.Number()),
			projectPath,
		}),
	},
	{
		name: "codegraph_status",
		label: "CodeGraph Status",
		description: "Index statistics for the project: files, symbols, last update.",
		snippet: "Index status",
		parameters: Type.Object({ projectPath }),
	},
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];
export const TOOL_NAMES: readonly string[] = TOOLS.map((t) => t.name);
export const isCodeGraphTool = (name: string): boolean => TOOL_NAMES.includes(name);

/** Guidelines added to the system prompt while the tools are active (static: they never break the prompt cache). */
export const GUIDELINES = [
	"Understand code through CodeGraph first: codegraph_explore for how something works or where to change it, codegraph_search to find a definition, codegraph_node with includeCode for a symbol's body (instead of rg -A), codegraph_callers/codegraph_callees for relations, codegraph_impact before changing a signature, codegraph_files for structure.",
	"Do not grep (rg, grep, git grep) for symbol names: such searches are redirected to CodeGraph. Text search is for string literals, comments, config and docs, or after CodeGraph came up empty.",
	"Read a file once CodeGraph has told you where to look, with offset/limit around the reported lines.",
];

/** Largest result handed to the model; the rest is cut with a note. */
export const MAX_RESULT_CHARS = 60_000;

export function resultText(result: { content?: { type: string; text?: string }[] } | undefined): string {
	const text = (result?.content ?? [])
		.filter((p) => p?.type === "text" && typeof p.text === "string")
		.map((p) => p.text)
		.join("\n");
	if (text.length <= MAX_RESULT_CHARS) return text || "(no result)";
	return `${text.slice(0, MAX_RESULT_CHARS)}\n\n[cut at ${MAX_RESULT_CHARS} characters: narrow the query, lower maxFiles/limit or pass a path]`;
}

/** `codegraph_files` wants a root-relative POSIX prefix; accept an absolute path inside the project too. */
export function normalizeFilesPath(path: unknown, root: string): string | undefined {
	if (typeof path !== "string" || path.trim() === "") return undefined;
	let p = path.trim().replace(/\\/g, "/");
	const r = root.replace(/\\/g, "/").replace(/\/$/, "");
	if (p === r) return undefined;
	if (p.startsWith(`${r}/`)) p = p.slice(r.length + 1).replace(/^(?:\.?\/)+/, "");
	return p.replace(/^\.\/(?:\.?\/)*/, "").replace(/\/$/, "") || undefined;
}
