/**
 * Which project CodeGraph serves, and what keeping its index current takes.
 *
 * Pure, except where a function takes the file system or a process runner as a parameter.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";

export interface Project {
	root: string;
	/** A `.codegraph/` directory exists at the root. */
	hasIndexDir: boolean;
	/** The root is a git work tree (so `init` there is expected, not a surprise). */
	isRepo: boolean;
}

/**
 * The project for `cwd`: the nearest directory with `.codegraph/`, else the nearest git
 * work tree. Never the home directory or a file-system root: indexing those is never wanted.
 */
export function findProject(cwd: string, exists: (p: string) => boolean = existsSync, home: string = homedir()): Project | undefined {
	let gitRoot: string | undefined;
	let dir = resolve(cwd);
	for (;;) {
		if (dir === home || dir === parse(dir).root) break;
		if (exists(join(dir, ".codegraph"))) return { root: dir, hasIndexDir: true, isRepo: exists(join(dir, ".git")) };
		if (gitRoot === undefined && exists(join(dir, ".git"))) gitRoot = dir;
		const up = dirname(dir);
		if (up === dir) break;
		dir = up;
	}
	return gitRoot === undefined ? undefined : { root: gitRoot, hasIndexDir: false, isRepo: true };
}

/** What `codegraph status -j` says, reduced to what matters here. */
export interface IndexStatus {
	initialized: boolean;
	/** `complete`, `indexing`, … (`unknown` when the field is missing). */
	state: string;
	files: number;
	pending: number;
	reindexRecommended: boolean;
	/** The index was built by another CodeGraph version than the one installed. */
	versionMismatch: boolean;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Parse `codegraph status -j`. Garbage (an old CodeGraph, a crash) reads as "not initialized". */
export function parseStatus(json: string): IndexStatus {
	let raw: any;
	try {
		raw = JSON.parse(json);
	} catch {
		raw = undefined;
	}
	const r = typeof raw === "object" && raw !== null ? raw : {};
	const index = typeof r.index === "object" && r.index !== null ? r.index : {};
	const pending = typeof r.pendingChanges === "object" && r.pendingChanges !== null ? r.pendingChanges : {};
	return {
		initialized: r.initialized === true,
		state: typeof index.state === "string" ? index.state : "unknown",
		files: num(r.fileCount),
		pending: num(pending.added) + num(pending.modified) + num(pending.removed),
		reindexRecommended: index.reindexRecommended === true,
		versionMismatch:
			typeof index.builtWithVersion === "string" && typeof r.version === "string" && index.builtWithVersion !== r.version,
	};
}

export type IndexAction = "init" | "index" | "sync" | "none" | "skip";

/**
 * What brings the index up to date: `init` when there is none (only in a git work tree, and
 * only when allowed), a full `index` when it is stale or broken, `sync` for pending changes.
 */
export function planIndex(status: IndexStatus, project: Project, opts: { autoInit: boolean }): IndexAction {
	if (!status.initialized) return opts.autoInit && project.isRepo ? "init" : "skip";
	if (status.reindexRecommended || status.versionMismatch || (status.state !== "complete" && status.state !== "indexing")) return "index";
	if (status.pending > 0) return "sync";
	return "none";
}

/** The CLI arguments for an action. */
export function actionArgs(action: Exclude<IndexAction, "none" | "skip">): string[] {
	switch (action) {
		case "init":
			return ["init", "-i", "-y"];
		case "index":
			return ["index", "-q"];
		case "sync":
			return ["sync", "-q"];
	}
}

/** Runs `codegraph <args>` in `cwd`; resolves with the exit code and output, never rejects. */
export type Runner = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface EnsureResult {
	action: IndexAction;
	status: IndexStatus;
	/** Set when CodeGraph is missing or a step failed. */
	error?: string;
}

/** Bring the index of `project` up to date: status, then init/index/sync as planned, then status again. */
export async function ensureIndex(project: Project, run: Runner, opts: { autoInit: boolean }): Promise<EnsureResult> {
	const first = await run(["status", "-j"], project.root);
	if (first.code === 127) return { action: "skip", status: parseStatus(""), error: "the codegraph CLI is not installed (npm i -g @colbymchenry/codegraph)" };
	const status = parseStatus(first.stdout);
	const action = planIndex(status, project, opts);
	if (action === "none" || action === "skip") return { action, status };
	const res = await run(actionArgs(action), project.root);
	const after = parseStatus((await run(["status", "-j"], project.root)).stdout);
	if (res.code !== 0) return { action, status: after, error: `codegraph ${action} failed (exit ${res.code}): ${lastLine(res.stderr || res.stdout)}` };
	return { action, status: after };
}

const lastLine = (s: string): string =>
	s
		.replace(/\u001b\[[0-9;]*m/g, "")
		.trim()
		.split("\n")
		.pop()!
		.slice(0, 300);
