import { describe, expect, test } from "bun:test";
import { completions, parseCommand } from "../extensions/command/parse.ts";

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

	test("level takes an integer 1..100", () => {
		expect(parseCommand("level 5")).toEqual({ kind: "level", level: 5 });
		for (const bad of ["level", "level 0", "level 101", "level x", "level 2.5"]) expect(parseCommand(bad).kind).toBe("invalid");
	});

	test("hello takes the rest of the line", () => {
		expect(parseCommand("hello big world")).toEqual({ kind: "hello", name: "big world" });
		expect(parseCommand("hello")).toEqual({ kind: "hello", name: "" });
	});

	test("anything else is invalid and prints the usage", () => {
		const c = parseCommand("bogus");
		expect(c.kind === "invalid" && c.message).toContain("Usage: /codegraph");
	});
});

describe("completions", () => {
	test("completes the top level by prefix, every item has a label", () => {
		expect(completions("")!.map((i) => i.value)).toEqual(["status", "on", "off", "level ", "hello"]);
		expect(completions("o")!.map((i) => i.label)).toEqual(["on", "off"]);
		expect(completions("  LEV")!.map((i) => i.label)).toEqual(["level"]);
		for (const i of completions("")!) expect(typeof i.label).toBe("string");
	});

	test("nothing matches, nothing is offered", () => {
		expect(completions("zzz")).toBeNull();
		expect(completions(undefined as unknown as string)).not.toBeNull();
	});
});
