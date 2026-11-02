import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clampInt, configPath, DEFAULT_CONFIG, loadConfig, readConfig, resolveAgentDir, sanitizeConfig, saveConfig } from "../extensions/core/config.ts";

describe("sanitizeConfig", () => {
	test("anything that is not an object gives the defaults", () => {
		for (const raw of [undefined, null, 5, "x", [], [1]]) expect(sanitizeConfig(raw)).toEqual(DEFAULT_CONFIG);
	});

	test("keeps valid values, defaults and clamps the rest", () => {
		expect(sanitizeConfig({ enabled: false, showStatus: false, level: 500 })).toEqual({ enabled: false, showStatus: false, level: 100 });
		expect(sanitizeConfig({ enabled: "yes", showStatus: 1, level: "3" })).toEqual(DEFAULT_CONFIG);
		expect(sanitizeConfig({ level: 0 }).level).toBe(1);
		expect(sanitizeConfig({ level: 2.6 }).level).toBe(3);
	});

	test("clampInt rejects NaN and infinity", () => {
		expect(clampInt(Number.NaN, 1, 5, 2)).toBe(2);
		expect(clampInt(Number.POSITIVE_INFINITY, 1, 5, 2)).toBe(2);
		expect(clampInt(9, 1, 5, 2)).toBe(5);
	});
});

describe("agent dir", () => {
	test("PI_CODING_AGENT_DIR wins, then XDG_CONFIG_HOME, then ~/.pi/agent", () => {
		expect(resolveAgentDir({ PI_CODING_AGENT_DIR: "/a", XDG_CONFIG_HOME: "/x" }, "/h")).toBe("/a");
		expect(resolveAgentDir({ XDG_CONFIG_HOME: "/x" }, "/h")).toBe(join("/x", "pi", "agent"));
		expect(resolveAgentDir({}, "/h")).toBe(join("/h", ".pi", "agent"));
	});

	test("the config lives next to pi's own files", () => {
		expect(configPath({ PI_CODING_AGENT_DIR: "/a" }, "/h")).toBe(join("/a", "codegraph.json"));
	});
});

describe("config file", () => {
	let file: string;
	beforeEach(() => {
		file = join(mkdtempSync(join(tmpdir(), "pi-config-")), "nested", "codegraph.json");
	});

	test("a missing file gives the defaults and no problem", async () => {
		expect(await readConfig(file)).toEqual({ config: DEFAULT_CONFIG });
		expect(await loadConfig(file)).toEqual(DEFAULT_CONFIG);
	});

	test("a broken file gives the defaults and says why", async () => {
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(file, "{ nope");
		const r = await readConfig(file);
		expect(r.config).toEqual(DEFAULT_CONFIG);
		expect(r.problem).toContain("is not valid JSON");
	});

	test("an unreadable path gives the defaults and says why", async () => {
		mkdirSync(file, { recursive: true }); // a directory where the file should be: EISDIR
		const r = await readConfig(file);
		expect(r.problem).toContain("cannot read");
	});

	test("save then load round-trips, creating the directory, leaving no temp file", async () => {
		await saveConfig({ enabled: false, showStatus: true, level: 77 }, file);
		expect(await loadConfig(file)).toEqual({ enabled: false, showStatus: true, level: 77 });
		expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
		expect(readdirSync(join(file, ".."))).toEqual(["codegraph.json"]);
	});

	test("a failed save cleans up and throws", async () => {
		mkdirSync(file, { recursive: true }); // rename onto a directory fails
		await expect(saveConfig(DEFAULT_CONFIG, file)).rejects.toThrow();
		expect(readdirSync(join(file, ".."))).toEqual(["codegraph.json"]);
	});
});
