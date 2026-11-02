/**
 * The CodeGraph-first gate: spots text searches (`rg`, `grep`, `git grep`, `ag`, `ack`, pi's
 * `grep` tool) whose pattern is really a symbol lookup, and decides whether to let them run.
 *
 * Pure: the extension feeds it commands and remembers what CodeGraph was already asked.
 */

/** One text search found in a command. `pattern` is undefined for a listing (`rg --files`). */
export interface Search {
	tool: string;
	pattern?: string;
	/** File and directory operands. */
	paths: string[];
	/** `--type`/`--glob`/`--include` filters, as written. */
	filters: string[];
	/** A file-name lookup (`fd Foo`, `find -name '*Foo*'`): only ever nudged, never blocked. */
	files?: true;
}

const OPERATORS = new Set(["|", "||", "&", "&&", ";", "(", ")", "\n", "|&"]);

/**
 * Split a shell command into simple commands (arrays of words). Handles quotes, backslash
 * escapes and the usual operators; anything stranger (subshell syntax, heredocs) degrades to
 * extra words, which only makes the gate more permissive.
 */
export function splitCommands(command: string): string[][] {
	return splitPipeline(command).map((c) => c.words);
}

/** Like `splitCommands`, also telling which commands read a pipe (`a | b`: b is piped). */
export function splitPipeline(command: string): { words: string[]; piped: boolean }[] {
	const out: { words: string[]; piped: boolean }[] = [];
	let cur: string[] = [];
	let word = "";
	let inWord = false;
	let piped = false;
	const endWord = () => {
		if (inWord) cur.push(word);
		word = "";
		inWord = false;
	};
	const endCommand = (nextPiped: boolean) => {
		endWord();
		if (cur.length > 0) out.push({ words: cur, piped });
		cur = [];
		piped = nextPiped;
	};
	for (let i = 0; i < command.length; i++) {
		const c = command[i]!;
		if (c === "'") {
			const end = command.indexOf("'", i + 1);
			const stop = end === -1 ? command.length : end;
			word += command.slice(i + 1, stop);
			inWord = true;
			i = stop;
		} else if (c === '"') {
			inWord = true;
			for (i++; i < command.length && command[i] !== '"'; i++) {
				if (command[i] === "\\" && i + 1 < command.length && '"\\$`'.includes(command[i + 1]!)) i++;
				word += command[i];
			}
		} else if (c === "\\" && i + 1 < command.length) {
			if (command[i + 1] !== "\n") word += command[i + 1];
			inWord = true;
			i++;
		} else if (c === " " || c === "\t") {
			endWord();
		} else if (OPERATORS.has(c)) {
			const double = command[i + 1] === c;
			endCommand(c === "|" && !double);
			if (double || (c === "|" && command[i + 1] === "&")) i++;
		} else {
			word += c;
			inWord = true;
		}
	}
	endCommand(false);
	return out;
}

/** Flags that take a value, per tool. Long flags may also be written `--flag=value`. */
const VALUE_FLAGS: Record<string, Set<string>> = {
	rg: new Set(
		"-A -B -C -m -M -j -d -E -g -t -T -r -f -e --after-context --before-context --context --max-count --max-columns --threads --max-depth --encoding --glob --iglob --type --type-not --type-add --type-clear --replace --file --regexp --color --colors --sort --sortr --pre --pre-glob --ignore-file --max-filesize --path-separator --field-match-separator --field-context-separator --context-separator --engine --dfa-size-limit --regex-size-limit --hostname-bin --hyperlink-format".split(" "),
	),
	grep: new Set("-A -B -C -m -e -f -d -D --after-context --before-context --context --max-count --regexp --file --include --exclude --exclude-dir --exclude-from --directories --devices --color --colour --label --binary-files".split(" ")),
	ag: new Set("-A -B -C -m -G -g --after --before --context --max-count --file-search-regex --ignore --ignore-dir --depth --pager".split(" ")),
	ack: new Set("-A -B -C -m -g --after-context --before-context --context --max-count --type --ignore-dir --ignore-file --output --match".split(" ")),
};
VALUE_FLAGS.egrep = VALUE_FLAGS.grep!;
VALUE_FLAGS.fgrep = VALUE_FLAGS.grep!;
VALUE_FLAGS["git grep"] = new Set("-A -B -C -m -e -f --after-context --before-context --context --max-count --max-depth --threads".split(" "));

const PATTERN_FLAGS = new Set(["-e", "--regexp"]);
const FILTER_FLAGS = new Set(["-g", "-t", "-T", "--glob", "--iglob", "--type", "--type-not", "--include", "-G", "--file-search-regex"]);
const WRAPPERS = new Set(["sudo", "command", "exec", "time", "nice", "nohup", "env", "xargs", "timeout"]);
/** Wrapper flags that take a separate value (`timeout -s KILL 5 rg …`, `nice -n 5 rg …`). */
const WRAPPER_VALUE_FLAGS: Record<string, Set<string>> = {
	timeout: new Set(["-s", "--signal", "-k", "--kill-after"]),
	nice: new Set(["-n", "--adjustment"]),
	sudo: new Set(["-u", "--user", "-g", "--group", "-C", "-D", "--chdir"]),
	xargs: new Set(["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a"]),
	env: new Set(["-u", "--unset", "-C", "--chdir"]),
};

/** The program of a simple command, skipping `VAR=x` assignments and wrappers like `xargs -0`. */
function programIndex(words: string[]): number {
	let i = 0;
	for (;;) {
		while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!)) i++;
		const w = words[i];
		if (w === undefined || !WRAPPERS.has(baseName(w))) return i;
		const wrapper = baseName(w);
		i++;
		while (i < words.length && words[i]!.startsWith("-")) i += WRAPPER_VALUE_FLAGS[wrapper]?.has(words[i]!) ? 2 : 1;
		if (wrapper === "timeout" && /^\d/.test(words[i] ?? "")) i++;
	}
}

const baseName = (w: string) => w.slice(w.lastIndexOf("/") + 1);

/** Every text search over files in a shell command (a filter reading a pipe searches no code). */
export function findSearches(command: string): Search[] {
	const out: Search[] = [];
	for (const { words, piped } of splitPipeline(command)) {
		const at = programIndex(words);
		const prog = baseName(words[at] ?? "");
		let tool: string;
		let args: string[];
		if (prog === "git") {
			let j = at + 1;
			while (j < words.length && words[j]!.startsWith("-")) j += words[j] === "-C" || words[j] === "-c" ? 2 : 1;
			if (words[j] !== "grep") continue;
			tool = "git grep";
			args = words.slice(j + 1);
		} else if (prog in VALUE_FLAGS && prog !== "git grep") {
			tool = prog;
			args = words.slice(at + 1);
		} else continue;
		const search = parseArgs(tool, args);
		// `… | rg x` filters the pipe; `… | xargs rg x` searches the files the pipe names.
		if (piped && search.paths.length === 0 && !words.slice(0, at).some((w) => baseName(w) === "xargs")) continue;
		out.push(search);
	}
	return out;
}

function parseArgs(tool: string, args: string[]): Search {
	const valueFlags = VALUE_FLAGS[tool]!;
	const positional: string[] = [];
	const filters: string[] = [];
	let pattern: string | undefined;
	let listing = false;
	let endOfFlags = false;
	for (let i = 0; i < args.length; i++) {
		const a = args[i]!;
		if (endOfFlags || !a.startsWith("-") || a === "-") {
			positional.push(a);
			continue;
		}
		if (a === "--") {
			endOfFlags = true;
			continue;
		}
		const eq = a.startsWith("--") ? a.indexOf("=") : -1;
		const flag = eq === -1 ? a : a.slice(0, eq);
		// Short flag cluster with an attached value (`-tmd`, `-e foo` as `-efoo`), or a cluster of booleans (`-rn`).
		const short = !a.startsWith("--") && a.length > 2 ? `-${a[1]}` : undefined;
		let value: string | undefined;
		let name = flag;
		if (eq !== -1) value = a.slice(eq + 1);
		else if (valueFlags.has(flag)) value = args[++i];
		else if (short && valueFlags.has(short)) {
			name = short;
			value = a.slice(2);
		}
		if (tool === "rg" && (name === "--files" || name === "--type-list")) listing = true;
		if (tool === "ag" && name === "-g") listing = true;
		if (value === undefined) continue;
		if (PATTERN_FLAGS.has(name)) pattern = pattern === undefined ? value : `${pattern}|${value}`;
		else if (FILTER_FLAGS.has(name) || (tool === "ack" && name === "--type")) filters.push(value);
		else if (name === "-f" || name === "--file") listing = true; // patterns come from a file: unknowable
	}
	if (listing && pattern === undefined) return { tool, paths: positional, filters };
	if (pattern === undefined) pattern = positional.shift();
	return { tool, pattern, paths: positional, filters };
}

/** Extensions CodeGraph indexes as code. Searches limited to anything else are left alone. */
export const CODE_EXTENSIONS = new Set(
	"ts tsx js jsx mjs cjs mts cts kt kts java scala groovy rs go py pyi rb php cs fs swift m mm c cc cpp cxx h hh hpp hxx dart lua ex exs erl hs ml vue svelte zig nim sol".split(" "),
);
const CODE_TYPES = new Set(
	"ts typescript js javascript kotlin kt java scala rust rs go py python ruby rb php cs csharp swift objc objcpp c cpp dart lua elixir erlang haskell ocaml vue svelte zig".split(" "),
);

const extOf = (p: string): string | undefined => {
	const base = baseName(p);
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(dot + 1).toLowerCase() : undefined;
};

/** Is the search restricted to non-code files (docs, config, logs)? */
export function targetsOnlyNonCode(s: Search): boolean {
	if (s.filters.length > 0) {
		const nonCode = s.filters.every((f) => {
			const neg = f.startsWith("!");
			if (neg) return false;
			const bare = f.replace(/^\{([^,{}]*)\}$/, "$1");
			const braces = /\.\{([A-Za-z0-9,]+)\}$/.exec(bare)?.[1];
			const exts = braces
				? braces.split(",").map((e) => e.toLowerCase())
				: [/\.([A-Za-z0-9]+)$/.exec(bare)?.[1]?.toLowerCase() ?? (bare.includes("*") || bare.includes(".") ? undefined : bare.toLowerCase())];
			return exts.every((ext) => ext !== undefined && ext !== "" && !CODE_EXTENSIONS.has(ext) && !CODE_TYPES.has(ext));
		});
		if (nonCode) return true;
	}
	const files = s.paths.filter((p) => extOf(p) !== undefined);
	return s.paths.length > 0 && files.length === s.paths.length && files.every((p) => !CODE_EXTENSIONS.has(extOf(p)!));
}

const DECL_KEYWORDS =
	"fn|pub fn|pub\\(crate\\) fn|async fn|def|class|struct|enum|trait|impl|interface|type|typealias|func|function|export function|export const|export class|export interface|export type|const|let|var|val|fun|suspend fun|object|data class|sealed class|protocol|extension|module|mod|use|import|from|new";
const DECL = new RegExp(`^(?:${DECL_KEYWORDS})(?:\\s+|\\\\s[+*])`);
const KEYWORDS = new Set(DECL_KEYWORDS.split("|").filter((k) => !k.includes(" ") && !k.includes("\\")));
const QUALIFIED = /^[A-Za-z_$][\w$]*(?:(?:::|\.|#|->)[A-Za-z_$][\w$]*)*$/;
const NOT_SYMBOLS = new Set(["todo", "fixme", "hack", "xxx", "note", "bug", "deprecated", "error", "warn", "warning", "info", "debug"]);

/** Strip regex syntax that does not change what is being looked for. */
function normalizeAlternative(raw: string): string {
	let s = raw.trim();
	s = s.replace(/\\[bB<>]/g, "").replace(/\[\[:<:\]\]|\[\[:>:\]\]/g, "");
	s = s.replace(/^\^/, "").replace(/\$$/, "");
	for (let prev = ""; prev !== s; ) {
		prev = s;
		s = s.replace(/^\((?:\?:)?/, "").replace(/\)$/, "");
	}
	s = s.replace(DECL, "");
	s = s.replace(/(?:\\?\(|\\?<|\s*\\s\*\\?\(|\s*\\s\*)$/, "");
	s = s.replace(/^(?:\.\*|\\s\*|\\s\+)+|(?:\.\*|\\s\*|\\s\+)+$/g, "");
	return s.trim();
}

/**
 * The identifiers a pattern looks for, when it is a symbol lookup (`fooBar`, `\bFoo\b`,
 * `fn parse_args`, `Foo::new`, `foo(`, `a|b`). Undefined for a text search (a sentence, a
 * string literal, a path, an error message, `TODO`).
 */
export function symbolsIn(pattern: string | undefined): string[] | undefined {
	if (pattern === undefined || pattern.length > 200) return undefined;
	const alternatives = pattern.split(/\\?\|/);
	const out: string[] = [];
	for (const alt of alternatives) {
		const s = normalizeAlternative(alt);
		if (s.length < 3 || !QUALIFIED.test(s) || KEYWORDS.has(s)) return undefined;
		const parts = s.split(/::|\.|#|->/);
		if (parts.some((p) => NOT_SYMBOLS.has(p.toLowerCase()))) return undefined;
		if (/^[A-Z0-9_]+$/.test(s) && s.length <= 4) return undefined;
		out.push(s);
	}
	return out.length > 0 ? out : undefined;
}

/** Words a CodeGraph call looked up, for remembering what is already answered. */
export function lookupWords(params: Record<string, unknown>): string[] {
	const out: string[] = [];
	for (const key of ["query", "symbol"]) {
		const v = params[key];
		if (typeof v === "string") for (const w of v.split(/[^\w$:.#>-]+/)) if (w.length >= 3) out.push(...w.split(/::|\.|#|->/).filter((x) => x.length >= 3), w);
	}
	return out.map((w) => w.toLowerCase());
}

export type Mode = "enforce" | "nudge" | "off";

export type Decision =
	| { action: "allow"; override?: true }
	| { action: "block"; reason: string }
	| { action: "nudge"; hint: string };

export interface GateMemory {
	/** Lower-cased words already looked up with CodeGraph this session. */
	lookedUp: Set<string>;
	/** Commands blocked once: running the same command again is the agent's explicit override. */
	blocked: Set<string>;
}

export const newMemory = (): GateMemory => ({ lookedUp: new Set(), blocked: new Set() });

const known = (symbol: string, mem: GateMemory) => {
	const s = symbol.toLowerCase();
	if (mem.lookedUp.has(s)) return true;
	const last = s.split(/::|\.|#|->/).pop()!;
	return mem.lookedUp.has(last);
};

export function suggestion(symbols: string[]): string {
	const q = symbols.join(" ");
	const one = symbols[0]!;
	return [
		`codegraph_search({ query: "${one}" }) for the definition`,
		`codegraph_callers({ symbol: "${one}" }) for usages`,
		`codegraph_explore({ query: "${q}" }) for the code around it`,
	].join(", ");
}

/**
 * What to do with a call to a text-search tool. `key` identifies the exact call (for the
 * re-run override); `searches` are what it searches for.
 */
export function decide(mode: Mode, searches: Search[], key: string, mem: GateMemory): Decision {
	if (mode === "off") return { action: "allow" };
	const symbols = new Set<string>();
	const names = new Set<string>();
	for (const s of searches) {
		if (targetsOnlyNonCode(s)) continue;
		for (const sym of (s.files ? fileSymbolIn(s.pattern) : symbolsIn(s.pattern)) ?? []) if (!known(sym, mem)) (s.files ? names : symbols).add(sym);
	}
	if (symbols.size === 0 && names.size === 0) return { action: "allow" };
	if (symbols.size === 0) {
		const [one] = [...names];
		return {
			action: "nudge",
			hint: `[codegraph] "${one}" looks like a symbol name: codegraph_search({ query: "${one}" }) finds where it is defined (file and line), codegraph_files lists the indexed files.`,
		};
	}
	const list = [...symbols];
	const hint = `"${list.join('", "')}" ${list.length === 1 ? "looks like a symbol" : "look like symbols"}: CodeGraph answers this structurally. Use ${suggestion(list)}.`;
	if (mode === "nudge") return { action: "nudge", hint: `[codegraph] ${hint}` };
	if (mem.blocked.has(key)) return { action: "allow", override: true };
	mem.blocked.add(key);
	return {
		action: "block",
		reason: `CodeGraph first: ${hint} If CodeGraph cannot answer it (string literals, comments, generated or non-indexed files), run the exact same command again and it will be allowed.`,
	};
}

/** Source files: reading many of them before any CodeGraph call earns a hint. */
export const isSourceFile = (path: string): boolean => {
	const ext = extOf(path);
	return ext !== undefined && CODE_EXTENSIONS.has(ext);
};

const FD_VALUE_FLAGS = new Set(
	"-e -t -E -d -x -X -S -c -j -g --extension --type --exclude --max-depth --min-depth --exact-depth --exec --exec-batch --size --changed-within --changed-before --owner --color --threads --max-results --base-directory --search-path --format --path-separator --batch-size --ignore-file".split(" "),
);
const FIND_NAME_FLAGS = new Set(["-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename"]);

/** File-name lookups in a shell command: `fd <pattern>`, `find … -name <glob>`. */
export function findFileSearches(command: string): Search[] {
	const out: Search[] = [];
	for (const { words } of splitPipeline(command)) {
		const at = programIndex(words);
		const prog = baseName(words[at] ?? "");
		const args = words.slice(at + 1);
		if (prog === "fd" || prog === "fdfind") {
			const positional: string[] = [];
			for (let i = 0; i < args.length; i++) {
				const a = args[i]!;
				if (!a.startsWith("-")) positional.push(a);
				else if (FD_VALUE_FLAGS.has(a)) i++;
			}
			if (positional.length > 0) out.push({ tool: prog, pattern: positional[0], paths: positional.slice(1), filters: [], files: true });
		} else if (prog === "find") {
			for (let i = 0; i < args.length - 1; i++) {
				if (FIND_NAME_FLAGS.has(args[i]!)) out.push({ tool: "find", pattern: args[i + 1], paths: [], filters: [], files: true });
			}
		}
	}
	return out;
}

/**
 * The symbol a file-name pattern looks for (`*ParseConfig*`, `user_service.rs`,
 * `^AuthController`), stricter than `symbolsIn`: a plain word like `config` names files, not
 * symbols, so it needs a camelCase/PascalCase hump or snake_case (`Readme`, `Makefile` are file names).
 */
export function fileSymbolIn(pattern: string | undefined): string[] | undefined {
	if (pattern === undefined) return undefined;
	const base = baseName(pattern)
		.replace(/^\^?\.\*|\.\*\$?$/g, "")
		.replace(/^[*^]+|[*$]+$/g, "")
		.replace(/\\?\.[A-Za-z0-9]{1,5}$/, "")
		.replace(/^[*^]+|[*$]+$/g, "");
	if (base.length < 4 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(base) || !/[a-z][A-Z]|[a-z0-9]_[a-z]/.test(base)) return undefined;
	if (NOT_SYMBOLS.has(base.toLowerCase())) return undefined;
	return [base];
}

const unquote = (quote: string, body: string): string => {
	if (quote === '"') {
		try {
			return JSON.parse(`"${body}"`);
		} catch {
			// not JSON-compatible: fall through to the plain unescape
		}
	}
	return body.replace(/\\(.)/g, "$1");
};

const STRING = String.raw`(["'\`])((?:\\.|(?!\1)[^\\])*)\1`;
const CODEMODE_BASH = new RegExp(String.raw`tools\.bash\(\s*\{[^}]*?\bcommand\s*:\s*` + STRING, "g");
const CODEMODE_GREP = new RegExp(String.raw`tools\.grep\(\s*\{[^}]*?\bpattern\s*:\s*` + STRING, "g");

/**
 * Searches a codemode script makes through `tools.bash({ command: "…" })` and
 * `tools.grep({ pattern: "…" })` with literal strings (a computed command is not knowable).
 */
export function codemodeSearches(code: string): Search[] {
	const out: Search[] = [];
	for (const m of code.matchAll(CODEMODE_BASH)) {
		const command = unquote(m[1]!, m[2]!);
		out.push(...findSearches(command), ...findFileSearches(command));
	}
	for (const m of code.matchAll(CODEMODE_GREP)) out.push({ tool: "grep", pattern: unquote(m[1]!, m[2]!), paths: [], filters: [] });
	return out;
}
