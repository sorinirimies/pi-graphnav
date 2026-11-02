// Randomised robustness tests ("fuzzing" without extra dependencies).
//
// The generator is seeded, so a failure prints a seed that reproduces it exactly:
//
//   FUZZ_SEED=12345 bun test tests/fuzz.test.ts --config=bunfig.fuzz.toml
//   FUZZ_ITERS=200000 bun test tests/fuzz.test.ts --config=bunfig.fuzz.toml   (the nightly workflow)
//
// One property per parser or pure function: assert what must ALWAYS hold, not one example.
import { describe, expect, it } from "bun:test";
import { parseCommand } from "../extensions/command/parse.ts";
import { MODES, sanitizeConfig } from "../extensions/core/config.ts";
import { findSearches, splitCommands, symbolsIn } from "../extensions/core/gate.ts";
import { parseStatus } from "../extensions/core/project.ts";
import { normalizeFilesPath } from "../extensions/core/tools.ts";

const ITERS = Number(process.env.FUZZ_ITERS ?? 400);
const SEED = Number(process.env.FUZZ_SEED ?? Math.floor(Math.random() * 2 ** 31));

/** mulberry32: small, fast, seedable. */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Printable ASCII, mostly; sometimes control characters and lone surrogates. */
function text(r: () => number, max = 24): string {
	const len = Math.floor(r() * max);
	let s = "";
	for (let i = 0; i < len; i++) s += String.fromCharCode(r() < 0.8 ? 32 + Math.floor(r() * 95) : Math.floor(r() * 0xd800));
	return s;
}

/** Text built from shell-ish pieces, so the command parser sees operators, quotes and flags often. */
const PIECES = ["rg", "grep", "git grep", "-e", "-n", "--type=ts", "-g", "'", '"', "\\", "|", "||", "&&", ";", "(", ")", "\n", "|&", "--", "-", "xargs", "timeout", "5", "FOO=1", "parseConfig", "a.md", "src"];
function shell(r: () => number): string {
	const n = Math.floor(r() * 12);
	let s = "";
	for (let i = 0; i < n; i++) s += (r() < 0.7 ? PIECES[Math.floor(r() * PIECES.length)] : text(r, 6)) + (r() < 0.7 ? " " : "");
	return s;
}

/** Run `fn` ITERS times; on failure say which iteration and how to reproduce it. */
function fuzz(name: string, fn: (r: () => number) => void, iters = ITERS) {
	it(`${name} (seed ${SEED}, ${iters} runs)`, () => {
		const r = rng(SEED);
		for (let i = 0; i < iters; i++) {
			try {
				fn(r);
			} catch (e) {
				throw new Error(`iteration ${i}, reproduce with FUZZ_SEED=${SEED}: ${(e as Error).message}`);
			}
		}
	});
}

describe("fuzz", () => {
	fuzz("parseCommand never throws and always returns a known kind", (r) => {
		const kind = parseCommand(r() < 0.5 ? text(r, 40) : `mode ${text(r, 10)}`).kind;
		expect(["status", "on", "off", "mode", "sync", "reindex", "init", "invalid"]).toContain(kind);
	});

	fuzz("sanitizeConfig turns any JSON into a valid config", (r) => {
		const raw =
			r() < 0.5
				? JSON.parse(
						JSON.stringify({
							enabled: r() < 0.5 ? text(r) : r() < 0.5,
							showStatus: r() < 0.5,
							mode: r() < 0.5 ? MODES[Math.floor(r() * 3)] : text(r),
							autoInit: r() < 0.5 ? 1 : true,
							readHintAfter: r() * 1000 - 300,
							timeoutMs: r() < 0.2 ? text(r) : r() * 2e6 - 1000,
						}),
					)
				: text(r);
		const c = sanitizeConfig(raw);
		for (const k of ["enabled", "showStatus", "autoInit", "autoSync", "watch"] as const) expect(typeof c[k]).toBe("boolean");
		expect(MODES).toContain(c.mode);
		expect(Number.isInteger(c.readHintAfter) && c.readHintAfter >= 0 && c.readHintAfter <= 100).toBe(true);
		expect(Number.isInteger(c.timeoutMs) && c.timeoutMs >= 1000 && c.timeoutMs <= 600_000).toBe(true);
	});

	fuzz("splitCommands and findSearches never throw on random input", (r) => {
		const cmd = r() < 0.5 ? shell(r) : text(r, 60);
		for (const words of splitCommands(cmd)) expect(words.length).toBeGreaterThan(0);
		for (const s of findSearches(cmd)) {
			expect(Array.isArray(s.paths)).toBe(true);
			expect(Array.isArray(s.filters)).toBe(true);
		}
	});

	fuzz("symbolsIn never throws and returns only identifier-like strings", (r) => {
		const p = r() < 0.5 ? text(r, 30) : `${r() < 0.5 ? "\\b" : ""}${text(r, 4)}${shell(r).replace(/\s+/g, "|")}`;
		const out = symbolsIn(p);
		if (out === undefined) return;
		expect(out.length).toBeGreaterThan(0);
		for (const s of out) expect(s).toMatch(/^[A-Za-z_$][\w$]*(?:(?:::|\.|#|->)[A-Za-z_$][\w$]*)*$/);
	});

	fuzz("parseStatus never throws on random text", (r) => {
		const raw = r() < 0.5 ? text(r, 60) : JSON.stringify({ initialized: r() < 0.5, fileCount: text(r), index: r() < 0.5 ? null : { state: text(r) } });
		const s = parseStatus(raw);
		expect(typeof s.initialized).toBe("boolean");
		expect(Number.isFinite(s.files) && Number.isFinite(s.pending)).toBe(true);
	});

	fuzz("normalizeFilesPath never returns a leading / for paths under the root", (r) => {
		const root = `/${text(r, 8).replace(/[\\/]/g, "") || "r"}`;
		const rel = text(r, 20);
		const out = normalizeFilesPath(`${root}/${rel}`, root);
		if (out !== undefined) expect(out.startsWith("/")).toBe(false);
	});
});
