/**
 * The persisted settings: <agent dir>/codegraph.json.
 *
 * A hand-edited file can hold anything, so `sanitizeConfig` keeps valid values and defaults the
 * rest. A missing file is not a problem (defaults); a broken one is reported, never thrown.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
	/** Master switch: when false the extension does nothing. */
	enabled: boolean;
	/** Show the status line entry. */
	showStatus: boolean;
	/** Sample number setting, clamped to 1..100. */
	level: number;
}

export const DEFAULT_CONFIG: Config = { enabled: true, showStatus: true, level: 10 };

export const clampInt = (v: unknown, min: number, max: number, fallback: number): number =>
	typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

export function sanitizeConfig(raw: unknown): Config {
	const r = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
	const d = DEFAULT_CONFIG;
	return {
		enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
		showStatus: typeof r.showStatus === "boolean" ? r.showStatus : d.showStatus,
		level: clampInt(r.level, 1, 100, d.level),
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
