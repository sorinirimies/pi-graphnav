/**
 * The persisted settings: <agent dir>/codegraph.json.
 *
 * A hand-edited file can hold anything, so `sanitizeConfig` keeps valid values and defaults the
 * rest. A missing file is not a problem (defaults); a broken one is reported, never thrown.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type Mode = "enforce" | "nudge" | "off";
export const MODES: readonly Mode[] = ["enforce", "nudge", "off"];

/** Status line: always, only when something needs attention (indexing, missing, error, unavailable), or never. */
export type StatusShow = "always" | "problems" | "never";
export const STATUS_SHOWS: readonly StatusShow[] = ["always", "problems", "never"];

/** `showStatus` from a config file: one of STATUS_SHOWS, or the 0.2 booleans (true = always, false = never). */
export function parseStatusShow(v: unknown): StatusShow | undefined {
	if (v === true) return "always";
	if (v === false) return "never";
	return STATUS_SHOWS.includes(v as StatusShow) ? (v as StatusShow) : undefined;
}

export interface Config {
	/** Master switch: when false the extension adds no guidance, gates nothing and indexes nothing. */
	enabled: boolean;
	/** When to show the status line entry. */
	showStatus: StatusShow;
	/** Symbol searches with rg/grep: block once (`enforce`), only add a hint (`nudge`) or leave alone (`off`). */
	mode: Mode;
	/** Create the index (`codegraph init`) for a git repo that has none. */
	autoInit: boolean;
	/** Sync or rebuild a stale index when the session starts. */
	autoSync: boolean;
	/** Keep the CodeGraph server's file watcher running, so the index follows edits. */
	watch: boolean;
	/** Source files read before any CodeGraph call that earn a hint (0 = never). */
	readHintAfter: number;
	/** Per-call timeout for the CodeGraph server, in ms. */
	timeoutMs: number;
}

export const DEFAULT_CONFIG: Config = {
	enabled: true,
	showStatus: "always",
	mode: "enforce",
	autoInit: true,
	autoSync: true,
	watch: true,
	readHintAfter: 3,
	timeoutMs: 30_000,
};

export const clampInt = (v: unknown, min: number, max: number, fallback: number): number =>
	typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

export function sanitizeConfig(raw: unknown): Config {
	const r = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
	const d = DEFAULT_CONFIG;
	return {
		enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
		showStatus: parseStatusShow(r.showStatus) ?? d.showStatus,
		mode: MODES.includes(r.mode as Mode) ? (r.mode as Mode) : d.mode,
		autoInit: typeof r.autoInit === "boolean" ? r.autoInit : d.autoInit,
		autoSync: typeof r.autoSync === "boolean" ? r.autoSync : d.autoSync,
		watch: typeof r.watch === "boolean" ? r.watch : d.watch,
		readHintAfter: clampInt(r.readHintAfter, 0, 100, d.readHintAfter),
		timeoutMs: clampInt(r.timeoutMs, 1000, 600_000, d.timeoutMs),
	};
}

/** Where pi keeps its config: PI_CODING_AGENT_DIR, then $XDG_CONFIG_HOME/pi/agent, then ~/.pi/agent. */
export function resolveAgentDir(env: Record<string, string | undefined>, home: string): string {
	if (env.PI_CODING_AGENT_DIR) return env.PI_CODING_AGENT_DIR;
	if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "pi", "agent");
	return join(home, ".pi", "agent");
}

export const configPath = (env: Record<string, string | undefined> = process.env, home = homedir()): string =>
	join(resolveAgentDir(env, home), "codegraph.json");

/** The config, plus a `problem` when the file exists but cannot be used. */
export async function readConfig(path = configPath()): Promise<{ config: Config; problem?: string }> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (e) {
		const code = (e as { code?: string } | null)?.code;
		return code === "ENOENT" ? { config: sanitizeConfig({}) } : { config: sanitizeConfig({}), problem: `cannot read ${path} (${code ?? "error"})` };
	}
	try {
		return { config: sanitizeConfig(JSON.parse(raw)) };
	} catch {
		return { config: sanitizeConfig({}), problem: `${path} is not valid JSON` };
	}
}

export async function loadConfig(path = configPath()): Promise<Config> {
	return (await readConfig(path)).config;
}

/** Atomic: written to a temp file and renamed, so a crash or a second pi session never leaves half a file. */
export async function saveConfig(config: Config, path = configPath()): Promise<void> {
	await mkdir(join(path, ".."), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
		await rename(tmp, path);
	} catch (e) {
		await Promise.allSettled([rm(tmp, { force: true })]); // the original error matters more
		throw e;
	}
}

/** What a project may override for itself, in `<project>/.pi/codegraph.json` (committable). */
export type ProjectOverrides = Partial<Pick<Config, "enabled" | "mode" | "autoInit" | "autoSync" | "readHintAfter">>;

/** Keep only the valid override keys; anything else in the file is ignored. */
export function sanitizeOverrides(raw: unknown): ProjectOverrides {
	const r = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
	const out: ProjectOverrides = {};
	for (const key of ["enabled", "autoInit", "autoSync"] as const) if (typeof r[key] === "boolean") out[key] = r[key] as boolean;
	if (MODES.includes(r.mode as Mode)) out.mode = r.mode as Mode;
	if (typeof r.readHintAfter === "number" && Number.isFinite(r.readHintAfter)) out.readHintAfter = clampInt(r.readHintAfter, 0, 100, 0);
	return out;
}

export const projectConfigPath = (root: string): string => join(root, ".pi", "codegraph.json");

/** A project's overrides; none when the file is missing, a `problem` when it is unusable. */
export async function readProjectConfig(root: string): Promise<{ overrides: ProjectOverrides; problem?: string }> {
	const path = projectConfigPath(root);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (e) {
		const code = (e as { code?: string } | null)?.code;
		return code === "ENOENT" ? { overrides: {} } : { overrides: {}, problem: `cannot read ${path} (${code ?? "error"})` };
	}
	try {
		return { overrides: sanitizeOverrides(JSON.parse(raw)) };
	} catch {
		return { overrides: {}, problem: `${path} is not valid JSON` };
	}
}
