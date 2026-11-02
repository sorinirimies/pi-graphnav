import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	clampInt,
	type Config,
	configPath,
	DEFAULT_CONFIG,
	loadConfig,
	MODES,
	projectConfigPath,
	readConfig,
	readProjectConfig,
	sanitizeOverrides,
	resolveAgentDir,
	sanitizeConfig,
	saveConfig,
} from "../extensions/core/config.ts";

describe("sanitizeConfig", () => {
	test("anything that is not an object gives the defaults", () => {
		for (const raw of [undefined, null, 5, "x", [], [1]]) expect(sanitizeConfig(raw)).toEqual(DEFAULT_CONFIG);
	});

	test("keeps valid values", () => {
		const c: Config = {
			enabled: false,
			showStatus: false,
			mode: "nudge",
			autoInit: false,
			autoSync: false,
			watch: false,
			readHintAfter: 0,
			timeoutMs: 5000,
		};
		expect(sanitizeConfig(c)).toEqual(c);
		for (const mode of MODES) expect(sanitizeConfig({ mode }).mode).toBe(mode);
	});

	test("defaults wrong types and unknown modes", () => {
		expect(
			sanitizeConfig({ enabled: "yes", showStatus: 1, mode: "loud", autoInit: null, autoSync: "x", watch: 0, readHintAfter: "3", timeoutMs: "9" }),
		).toEqual(DEFAULT_CONFIG);
	});

	test("clamps and rounds the numbers", () => {
		expect(sanitizeConfig({ readHintAfter: -5 }).readHintAfter).toBe(0);
		expect(sanitizeConfig({ readHintAfter: 500 }).readHintAfter).toBe(100);
		expect(sanitizeConfig({ readHintAfter: 2.6 }).readHintAfter).toBe(3);
		expect(sanitizeConfig({ timeoutMs: 1 }).timeoutMs).toBe(1000);
		expect(sanitizeConfig({ timeoutMs: 1e9 }).timeoutMs).toBe(600_000);
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
		expect(configPath()).toBe(join(process.env.PI_CODING_AGENT_DIR!, "codegraph.json"));
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
		const c = { ...DEFAULT_CONFIG, enabled: false, mode: "off" as const, readHintAfter: 7 };
		await saveConfig(c, file);
		expect(await loadConfig(file)).toEqual(c);
		expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
		expect(readdirSync(join(file, ".."))).toEqual(["codegraph.json"]);
	});

	test("a failed save cleans up and throws", async () => {
		mkdirSync(file, { recursive: true }); // rename onto a directory fails
		await expect(saveConfig(DEFAULT_CONFIG, file)).rejects.toThrow();
		expect(readdirSync(join(file, ".."))).toEqual(["codegraph.json"]);
	});
});

describe("project overrides", () => {
	test("sanitizeOverrides keeps only valid keys", () => {
		expect(sanitizeOverrides({ mode: "nudge", enabled: false, autoInit: false, autoSync: true, readHintAfter: 7.6, watch: false, junk: 1 })).toEqual({
			mode: "nudge",
			enabled: false,
			autoInit: false,
			autoSync: true,
			readHintAfter: 8,
		});
		expect(sanitizeOverrides({ mode: "loud", enabled: "no", readHintAfter: Number.NaN })).toEqual({});
		for (const raw of [null, 3, "x", []]) expect(sanitizeOverrides(raw)).toEqual({});
	});

	test("readProjectConfig: missing, valid, broken, unreadable", async () => {
		const root = mkdtempSync(join(tmpdir(), "cg-proj-"));
		expect(projectConfigPath(root)).toBe(join(root, ".pi", "codegraph.json"));
		expect(await readProjectConfig(root)).toEqual({ overrides: {} });
		mkdirSync(join(root, ".pi"));
		writeFileSync(projectConfigPath(root), JSON.stringify({ mode: "off" }));
		expect(await readProjectConfig(root)).toEqual({ overrides: { mode: "off" } });
		writeFileSync(projectConfigPath(root), "{nope");
		expect((await readProjectConfig(root)).problem).toContain("is not valid JSON");
		const dir = mkdtempSync(join(tmpdir(), "cg-proj-"));
		mkdirSync(join(dir, ".pi", "codegraph.json"), { recursive: true });
		const r = await readProjectConfig(dir);
		expect(r.overrides).toEqual({});
		expect(r.problem).toContain("cannot read");
	});
});
