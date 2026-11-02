// Every `/codegraph ...` command the README shows must be a real command: docs and code stay in step.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCommand } from "../extensions/command/parse.ts";

// Windows checkouts may convert to CRLF: compare on LF only.
const readme = readFileSync(join(import.meta.dir, "..", "README.md"), "utf8").replace(/\r\n/g, "\n");

/** `/codegraph ...` spans, with `a|b` alternatives and <placeholders> expanded. */
function documented(): string[] {
	const PLACEHOLDERS: Record<string, string> = { "<mode>": "nudge", "<enforce|nudge|off>": "nudge" };
	const out = new Set<string>();
	for (const m of readme.matchAll(/`(\/codegraph[^`]*)`/g)) {
		let variants = [m[1]!.replace(/\\\|/g, "|")];
		for (let i = 0; i < 4; i++) {
			variants = variants.flatMap((v) => {
				const alt = v.match(/\[([^\[\]]*\|[^\[\]]*)\]/);
				return alt ? alt[1]!.split("|").map((a) => v.replace(alt[0], a)) : [v];
			});
		}
		for (let v of variants) {
			for (const [ph, val] of Object.entries(PLACEHOLDERS)) v = v.split(ph).join(val);
			out.add(v.replace(/^\/codegraph\s*/, "").trim());
		}
	}
	return [...out];
}

describe("README", () => {
	test("documents at least one command", () => {
		expect(documented().length).toBeGreaterThan(0);
	});

	test("every documented command parses", () => {
		for (const args of documented()) expect(parseCommand(args).kind, `/codegraph ${args}`).not.toBe("invalid");
	});
});
