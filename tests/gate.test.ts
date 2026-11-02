import { describe, expect, test } from "bun:test";
import {
	CODE_EXTENSIONS,
	decide,
	findSearches,
	isSourceFile,
	lookupWords,
	newMemory,
	type Search,
	splitCommands,
	splitPipeline,
	suggestion,
	symbolsIn,
	targetsOnlyNonCode,
} from "../extensions/core/gate.ts";

const search = (s: Partial<Search>): Search => ({ tool: "rg", paths: [], filters: [], ...s });

describe("splitCommands", () => {
	test("words and operators", () => {
		expect(splitCommands("rg -n foo src | head -5 && echo done; ls")).toEqual([
			["rg", "-n", "foo", "src"],
			["head", "-5"],
			["echo", "done"],
			["ls"],
		]);
		expect(splitCommands("a || b |& c & d\ne (f)")).toEqual([["a"], ["b"], ["c"], ["d"], ["e"], ["f"]]);
	});

	test("quotes and escapes", () => {
		expect(splitCommands(`rg 'a b' "c \\"d\\" \\$e \\x" f\\ g`)).toEqual([["rg", "a b", 'c "d" $e \\x', "f g"]]);
		expect(splitCommands("rg ''")).toEqual([["rg", ""]]);
		expect(splitCommands("rg 'unterminated")).toEqual([["rg", "unterminated"]]);
		expect(splitCommands('rg "unterminated')).toEqual([["rg", "unterminated"]]);
		expect(splitCommands("rg a\\\nb")).toEqual([["rg", "ab"]]);
		expect(splitCommands("rg a\\")).toEqual([["rg", "a\\"]]);
		expect(splitCommands("rg\tfoo")).toEqual([["rg", "foo"]]);
	});

	test("empty input gives no commands", () => {
		expect(splitCommands("")).toEqual([]);
		expect(splitCommands(" ; && ")).toEqual([]);
	});

	test("splitPipeline marks the commands that read a pipe", () => {
		expect(splitPipeline("a | b || c |& d && e")).toEqual([
			{ words: ["a"], piped: false },
			{ words: ["b"], piped: true },
			{ words: ["c"], piped: false },
			{ words: ["d"], piped: true },
			{ words: ["e"], piped: false },
		]);
	});
});

describe("findSearches", () => {
	test("rg with flags, pattern and paths", () => {
		expect(findSearches("rg -n -A 3 parseConfig src lib")).toEqual([{ tool: "rg", pattern: "parseConfig", paths: ["src", "lib"], filters: [] }]);
		expect(findSearches("rg --type=ts -g '*.md' -tpy foo")).toEqual([{ tool: "rg", pattern: "foo", paths: [], filters: ["ts", "*.md", "py"] }]);
	});

	test("-e/--regexp patterns combine; positional then are paths", () => {
		expect(findSearches("rg -e foo --regexp=bar -ebaz src")).toEqual([{ tool: "rg", pattern: "foo|bar|baz", paths: ["src"], filters: [] }]);
	});

	test("-- ends the flags, - is a path", () => {
		expect(findSearches("rg -- -foo -")).toEqual([{ tool: "rg", pattern: "-foo", paths: ["-"], filters: [] }]);
	});

	test("boolean clusters are skipped", () => {
		expect(findSearches("grep -rn Foo .")).toEqual([{ tool: "grep", pattern: "Foo", paths: ["."], filters: [] }]);
		expect(findSearches("grep -r --include '*.kt' Foo .")[0]!.filters).toEqual(["*.kt"]);
	});

	test("listings have no pattern", () => {
		expect(findSearches("rg --files src")).toEqual([{ tool: "rg", paths: ["src"], filters: [] }]);
		expect(findSearches("rg --type-list")).toEqual([{ tool: "rg", paths: [], filters: [] }]);
		expect(findSearches("ag -g foo")).toEqual([{ tool: "ag", paths: [], filters: ["foo"] }]);
		expect(findSearches("grep -f pats.txt src")).toEqual([{ tool: "grep", paths: ["src"], filters: [] }]);
		expect(findSearches("rg --files -e foo")[0]!.pattern).toBe("foo");
	});

	test("git grep, through git's global flags", () => {
		expect(findSearches("git -C repo -c a=b --no-pager grep -n Foo")).toEqual([{ tool: "git grep", pattern: "Foo", paths: [], filters: [] }]);
		expect(findSearches("git log --oneline")).toEqual([]);
		expect(findSearches("git")).toEqual([]);
	});

	test("wrappers, assignments and paths to the program", () => {
		expect(findSearches("FOO=1 sudo -E /usr/bin/rg Foo")[0]!.tool).toBe("rg");
		expect(findSearches("timeout 5 rg Foo")[0]!.pattern).toBe("Foo");
		expect(findSearches("nice -n5 timeout 5s grep Foo")[0]!.tool).toBe("grep");
		expect(findSearches("xargs -0 egrep Foo")).toEqual([{ tool: "egrep", pattern: "Foo", paths: [], filters: [] }]);
		expect(findSearches("env")).toEqual([]);
	});

	test("a filter on a pipe searches no code; xargs on a pipe does", () => {
		expect(findSearches("ps aux | grep node")).toEqual([]);
		expect(findSearches("rg --files | rg codegraph")).toEqual([{ tool: "rg", paths: [], filters: [] }]);
		expect(findSearches("cat x | grep Foo src")[0]!.paths).toEqual(["src"]);
		expect(findSearches("fd -e ts | xargs rg parseConfig")[0]!.pattern).toBe("parseConfig");
		expect(findSearches("true || rg Foo")[0]!.pattern).toBe("Foo");
	});

	test("a filter reading a pipe searches no files; with paths it does", () => {
		expect(findSearches("cargo test | rg Foo")).toEqual([]);
		expect(findSearches("cargo test |& rg Foo")).toEqual([]);
		expect(findSearches("ls | rg Foo src")).toEqual([{ tool: "rg", pattern: "Foo", paths: ["src"], filters: [] }]);
		expect(findSearches("false || rg Foo")).toEqual([{ tool: "rg", pattern: "Foo", paths: [], filters: [] }]);
	});

	test("ack, fgrep, and the rest ignored", () => {
		expect(findSearches("ack --type ruby Foo")).toEqual([{ tool: "ack", pattern: "Foo", paths: [], filters: ["ruby"] }]);
		expect(findSearches("fgrep Foo x")[0]!.tool).toBe("fgrep");
		expect(findSearches("cat foo; ls; echo rg")).toEqual([]);
		expect(findSearches("rg")).toEqual([{ tool: "rg", pattern: undefined, paths: [], filters: [] }]);
		expect(findSearches("rg -A")).toEqual([{ tool: "rg", pattern: undefined, paths: [], filters: [] }]);
	});
});

describe("targetsOnlyNonCode", () => {
	test("non-code files and filters", () => {
		expect(targetsOnlyNonCode(search({ paths: ["README.md"] }))).toBe(true);
		expect(targetsOnlyNonCode(search({ paths: ["README.md", "a.json"] }))).toBe(true);
		expect(targetsOnlyNonCode(search({ filters: ["*.md"] }))).toBe(true);
		expect(targetsOnlyNonCode(search({ filters: ["{*.yml}"] }))).toBe(true);
		expect(targetsOnlyNonCode(search({ filters: ["markdown"] }))).toBe(true);
	});

	test("code, directories, negations and unknowable filters", () => {
		expect(targetsOnlyNonCode(search({}))).toBe(false);
		expect(targetsOnlyNonCode(search({ paths: ["src"] }))).toBe(false);
		expect(targetsOnlyNonCode(search({ paths: ["a.md", "b.ts"] }))).toBe(false);
		expect(targetsOnlyNonCode(search({ paths: ["a.md", "src"] }))).toBe(false);
		expect(targetsOnlyNonCode(search({ filters: ["*.ts"] }))).toBe(false);
		expect(targetsOnlyNonCode(search({ filters: ["ts"] }))).toBe(false);
		expect(targetsOnlyNonCode(search({ filters: ["!*.md"] }))).toBe(false);
		expect(targetsOnlyNonCode(search({ filters: ["src/*"] }))).toBe(false);
		expect(targetsOnlyNonCode(search({ filters: ["*.md", "*.rs"] }))).toBe(false);
		expect(targetsOnlyNonCode(search({ filters: ["*.ts"], paths: ["docs/a.md"] }))).toBe(true);
		expect(targetsOnlyNonCode(search({ paths: [".gitignore"] }))).toBe(false);
	});
});

describe("symbolsIn", () => {
	test("plain and qualified identifiers", () => {
		expect(symbolsIn("parseConfig")).toEqual(["parseConfig"]);
		expect(symbolsIn("Foo::new")).toEqual(["Foo::new"]);
		expect(symbolsIn("obj.method")).toEqual(["obj.method"]);
		expect(symbolsIn("a->b_c")).toEqual(["a->b_c"]);
	});

	test("regex decoration and declarations are stripped", () => {
		expect(symbolsIn("\\bparseConfig\\b")).toEqual(["parseConfig"]);
		expect(symbolsIn("^parseConfig$")).toEqual(["parseConfig"]);
		expect(symbolsIn("fn parse_args")).toEqual(["parse_args"]);
		expect(symbolsIn("fn\\s+parse_args")).toEqual(["parse_args"]);
		expect(symbolsIn("class Foo")).toEqual(["Foo"]);
		expect(symbolsIn("parseConfig(")).toEqual(["parseConfig"]);
		expect(symbolsIn("parseConfig\\(")).toEqual(["parseConfig"]);
		expect(symbolsIn("parseConfig\\s*\\(")).toEqual(["parseConfig"]);
		expect(symbolsIn(".*parseConfig.*")).toEqual(["parseConfig"]);
		expect(symbolsIn("((?:parseConfig))")).toEqual(["parseConfig"]);
		expect(symbolsIn("[[:<:]]parseConfig[[:>:]]")).toEqual(["parseConfig"]);
	});

	test("alternatives", () => {
		expect(symbolsIn("fooBar|bazQux")).toEqual(["fooBar", "bazQux"]);
		expect(symbolsIn("(fooBar\\|bazQux)")).toEqual(["fooBar", "bazQux"]);
		expect(symbolsIn("fooBar|some text")).toBeUndefined();
	});

	test("text searches are not symbols", () => {
		for (const p of [undefined, "", "ab", "hello world", "\"quoted\"", "src/foo.ts", "TODO", "fixme.later", "ERR", "ABCD", "x".repeat(201), "Error: failed"])
			expect(symbolsIn(p)).toBeUndefined();
		expect(symbolsIn("ABCDE")).toEqual(["ABCDE"]);
		expect(symbolsIn("class")).toBeUndefined();
		expect(symbolsIn("function")).toBeUndefined();
	});
});

describe("lookupWords", () => {
	test("query and symbol words, with qualified parts, lower-cased", () => {
		expect(lookupWords({ query: "parseConfig loadSettings", symbol: "Foo::bar_baz", other: "ignored" })).toEqual([
			"parseconfig",
			"parseconfig",
			"loadsettings",
			"loadsettings",
			"foo",
			"bar_baz",
			"foo::bar_baz",
		]);
		expect(lookupWords({ query: "ab x", symbol: 5 })).toEqual([]);
		expect(lookupWords({})).toEqual([]);
	});
});

describe("decide", () => {
	const rg = (pattern: string, paths: string[] = []) => [search({ pattern, paths })];

	test("off always allows", () => {
		expect(decide("off", rg("parseConfig"), "k", newMemory())).toEqual({ action: "allow" });
	});

	test("enforce blocks a symbol search once, then allows the same call", () => {
		const mem = newMemory();
		const d = decide("enforce", rg("parseConfig"), "k", mem);
		expect(d.action).toBe("block");
		expect(d.action === "block" && d.reason).toContain('"parseConfig" looks like a symbol');
		expect(d.action === "block" && d.reason).toContain("run the exact same command again");
		expect(decide("enforce", rg("parseConfig"), "k", mem)).toEqual({ action: "allow" });
		expect(decide("enforce", rg("parseConfig"), "other", mem).action).toBe("block");
	});

	test("nudge gives a hint, several symbols are listed", () => {
		const d = decide("nudge", [search({ pattern: "fooBar|bazQux" }), search({ pattern: "fooBar" })], "k", newMemory());
		expect(d).toEqual({ action: "nudge", hint: expect.stringContaining('[codegraph] "fooBar", "bazQux" look like symbols') });
	});

	test("text searches, non-code targets and known symbols are allowed", () => {
		expect(decide("enforce", rg("hello world"), "k", newMemory())).toEqual({ action: "allow" });
		expect(decide("enforce", rg("parseConfig", ["README.md"]), "k", newMemory())).toEqual({ action: "allow" });
		expect(decide("enforce", [search({})], "k", newMemory())).toEqual({ action: "allow" });
		const mem = newMemory();
		mem.lookedUp.add("parseconfig");
		mem.lookedUp.add("bar");
		expect(decide("enforce", rg("parseConfig"), "k", mem)).toEqual({ action: "allow" });
		expect(decide("enforce", rg("Foo::bar"), "k", mem)).toEqual({ action: "allow" });
	});
});

describe("suggestion and isSourceFile", () => {
	test("suggestion names the first symbol and the whole query", () => {
		const s = suggestion(["a1x", "b2y"]);
		expect(s).toContain('codegraph_search({ query: "a1x" })');
		expect(s).toContain('codegraph_callers({ symbol: "a1x" })');
		expect(s).toContain('codegraph_explore({ query: "a1x b2y" })');
	});

	test("isSourceFile by extension", () => {
		expect(isSourceFile("src/a.TS")).toBe(true);
		expect(isSourceFile("/x/y/main.rs")).toBe(true);
		expect(isSourceFile("README.md")).toBe(false);
		expect(isSourceFile(".bashrc")).toBe(false);
		expect(isSourceFile("Makefile")).toBe(false);
		expect(CODE_EXTENSIONS.has("kt")).toBe(true);
	});
});
