import { describe, expect, test } from "bun:test";
import { completions, parseCommand, USAGE } from "../extensions/command/parse.ts";

describe("parseCommand", () => {
	test("no argument and status show the status", () => {
		expect(parseCommand(undefined)).toEqual({ kind: "status" });
		expect(parseCommand("  ")).toEqual({ kind: "status" });
		expect(parseCommand("STATUS")).toEqual({ kind: "status" });
	});

	test("on and off, with their long forms", () => {
		expect(parseCommand("on")).toEqual({ kind: "on" });
		expect(parseCommand("enable")).toEqual({ kind: "on" });
		expect(parseCommand("off")).toEqual({ kind: "off" });
		expect(parseCommand("disable")).toEqual({ kind: "off" });
	});

	test("mode takes exactly one of enforce, nudge, off", () => {
		expect(parseCommand("mode enforce")).toEqual({ kind: "mode", mode: "enforce" });
		expect(parseCommand("statusline Problems")).toEqual({ kind: "statusline", show: "problems" });
		for (const bad of ["statusline", "statusline loud", "statusline never now"])
			expect(parseCommand(bad)).toEqual({ kind: "invalid", message: "Usage: /codegraph statusline <always|problems|never>" });
		expect(parseCommand("mode NUDGE")).toEqual({ kind: "mode", mode: "nudge" });
		expect(parseCommand(" mode   off ")).toEqual({ kind: "mode", mode: "off" });
		for (const bad of ["mode", "mode loud", "mode nudge off"]) {
			const c = parseCommand(bad);
			expect(c.kind === "invalid" && c.message).toContain("mode <enforce|nudge|off>");
		}
	});

	test("sync, reindex (alias index) and init", () => {
		expect(parseCommand("sync")).toEqual({ kind: "sync" });
		expect(parseCommand("reindex")).toEqual({ kind: "reindex" });
		expect(parseCommand("index")).toEqual({ kind: "reindex" });
		expect(parseCommand("init")).toEqual({ kind: "init" });
	});

	test("anything else is invalid and prints the usage", () => {
		const c = parseCommand("bogus");
		expect(c.kind === "invalid" && c.message).toContain('Unknown option "bogus"');
		expect(c.kind === "invalid" && c.message).toContain(USAGE);
	});
});

describe("completions", () => {
	test("completes the top level by prefix, every item has a label", () => {
		expect(completions("")!.map((i) => i.value)).toEqual(["status", "on", "off", "mode ", "statusline ", "sync", "reindex", "init"]);
		expect(completions("o")!.map((i) => i.label)).toEqual(["on", "off"]);
		expect(completions("  MO")!.map((i) => i.label)).toEqual(["mode"]);
		for (const i of completions("")!) expect(typeof i.label).toBe("string");
	});

	test("after `mode ` it offers the modes", () => {
		expect(completions("mode ")!.map((i) => i.value)).toEqual(["mode enforce", "mode nudge", "mode off"]);
		expect(completions("statusline p")!.map((i) => i.value)).toEqual(["statusline problems"]);
		expect(completions("mode n")!.map((i) => i.label)).toEqual(["nudge"]);
		expect(completions("mode x")).toBeNull();
	});

	test("nothing matches, nothing is offered", () => {
		expect(completions("zzz")).toBeNull();
		expect(completions(undefined as unknown as string)).not.toBeNull();
	});
});
