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

export interface Config {
	/** Master switch: when false the extension adds no guidance, gates nothing and indexes nothing. */
	enabled: boolean;
	/** Show the status line entry. */
	showStatus: boolean;
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
	showStatus: true,
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
		showStatus: typeof r.showStatus === "boolean" ? r.showStatus : d.showStatus,
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
