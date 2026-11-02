import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import {
	actionArgs,
	ensureIndex,
	findProject,
	type IndexStatus,
	parseStatus,
	planIndex,
	type Project,
	type Runner,
} from "../extensions/core/project.ts";

const HOME = resolve("/home/me");

describe("findProject", () => {
	const fs = (...paths: string[]) => {
		const set = new Set(paths.map((p) => resolve(p)));
		return (p: string) => set.has(p);
	};

	test("the nearest .codegraph wins, noting whether it is a repo", () => {
		const exists = fs("/work/repo/.git", "/work/repo/pkg/.codegraph");
		expect(findProject("/work/repo/pkg/src", exists, HOME)).toEqual({ root: resolve("/work/repo/pkg"), hasIndexDir: true, isRepo: false });
		expect(findProject("/work/repo/src", fs("/work/repo/.git", "/work/repo/.codegraph"), HOME)).toEqual({
			root: resolve("/work/repo"),
			hasIndexDir: true,
			isRepo: true,
		});
	});

	test("an index above the git root still wins; else the nearest git root", () => {
		expect(findProject("/work/repo/sub/x", fs("/work/repo/sub/.git", "/work/repo/.git"), HOME)).toEqual({
			root: resolve("/work/repo/sub"),
			hasIndexDir: false,
			isRepo: true,
		});
		expect(findProject("/work/repo/sub/x", fs("/work/repo/sub/.git", "/work/.codegraph"), HOME)!.root).toBe(resolve("/work"));
	});

	test("never the home directory or the file-system root", () => {
		expect(findProject(join(HOME, "notes"), fs(join(HOME, ".git"), join(HOME, ".codegraph")), HOME)).toBeUndefined();
		expect(findProject("/", fs("/.git"), HOME)).toBeUndefined();
		expect(findProject("/tmp/x", () => false, HOME)).toBeUndefined();
	});

	test("defaults to the real file system", () => {
		expect(findProject(import.meta.dir)?.root).toBe(resolve(import.meta.dir, ".."));
	});
});

const STATUS = {
	initialized: true,
	version: "1.6.2",
	fileCount: 3,
	pendingChanges: { added: 1, modified: 2, removed: 3 },
	index: { state: "complete", builtWithVersion: "1.6.2", reindexRecommended: false },
};

describe("parseStatus", () => {
	test("reads codegraph status -j", () => {
		expect(parseStatus(JSON.stringify(STATUS))).toEqual({
			initialized: true,
			state: "complete",
			files: 3,
			pending: 6,
			reindexRecommended: false,
			versionMismatch: false,
		});
	});

	test("version mismatch and reindex recommendation", () => {
		const s = parseStatus(JSON.stringify({ ...STATUS, index: { state: "complete", builtWithVersion: "1.0.0", reindexRecommended: true } }));
		expect(s.versionMismatch).toBe(true);
		expect(s.reindexRecommended).toBe(true);
	});

	test("garbage reads as not initialized", () => {
		const none: IndexStatus = { initialized: false, state: "unknown", files: 0, pending: 0, reindexRecommended: false, versionMismatch: false };
		for (const s of ["", "nope", "null", "5", '"x"', "[]"]) expect(parseStatus(s)).toEqual(none);
		expect(parseStatus(JSON.stringify({ initialized: "yes", fileCount: Number.NaN, index: null, pendingChanges: null }))).toEqual(none);
		expect(parseStatus(JSON.stringify({ fileCount: "3", pendingChanges: { added: "1" }, index: { state: 1 } }))).toEqual(none);
	});
});

const repo: Project = { root: "/r", hasIndexDir: true, isRepo: true };
const plain: Project = { root: "/r", hasIndexDir: true, isRepo: false };
const st = (o: Partial<IndexStatus>): IndexStatus => ({
	initialized: true,
	state: "complete",
	files: 1,
	pending: 0,
	reindexRecommended: false,
	versionMismatch: false,
	...o,
});

describe("planIndex and actionArgs", () => {
	test("no index: init in a repo when allowed, else skip", () => {
		expect(planIndex(st({ initialized: false }), repo, { autoInit: true })).toBe("init");
		expect(planIndex(st({ initialized: false }), repo, { autoInit: false })).toBe("skip");
		expect(planIndex(st({ initialized: false }), plain, { autoInit: true })).toBe("skip");
	});

	test("stale or broken: full index; pending: sync; else none", () => {
		const o = { autoInit: true };
		expect(planIndex(st({ reindexRecommended: true }), repo, o)).toBe("index");
		expect(planIndex(st({ versionMismatch: true }), repo, o)).toBe("index");
		expect(planIndex(st({ state: "failed" }), repo, o)).toBe("index");
		expect(planIndex(st({ state: "indexing", pending: 2 }), repo, o)).toBe("sync");
		expect(planIndex(st({}), repo, o)).toBe("none");
	});

	test("CLI arguments", () => {
		expect(actionArgs("init")).toEqual(["init", "-i", "-y"]);
		expect(actionArgs("index")).toEqual(["index", "-q"]);
		expect(actionArgs("sync")).toEqual(["sync", "-q"]);
	});
});

/** A runner answering from a script: `status` gives each status in turn (the last one repeats). */
function runner(statuses: unknown[], action: { code: number; stdout?: string; stderr?: string } = { code: 0 }) {
	const calls: string[][] = [];
	let i = 0;
	const run: Runner = async (args, cwd) => {
		calls.push([cwd, ...args]);
		if (args[0] === "status") return { code: 0, stdout: JSON.stringify(statuses[Math.min(i++, statuses.length - 1)]), stderr: "" };
		return { stdout: "", stderr: "", ...action };
	};
	return { run, calls };
}

describe("ensureIndex", () => {
	test("up to date: only the status", async () => {
		const { run, calls } = runner([{ ...STATUS, pendingChanges: {} }]);
		const r = await ensureIndex(repo, run, { autoInit: true });
		expect(r).toEqual({ action: "none", status: expect.objectContaining({ initialized: true, files: 3 }) });
		expect(calls).toEqual([["/r", "status", "-j"]]);
	});

	test("pending changes: sync, then the status again", async () => {
		const { run, calls } = runner([STATUS, { ...STATUS, fileCount: 9, pendingChanges: {} }]);
		const r = await ensureIndex(repo, run, { autoInit: true });
		expect(r.action).toBe("sync");
		expect(r.status.files).toBe(9);
		expect(r.error).toBeUndefined();
		expect(calls.map((c) => c[1])).toEqual(["status", "sync", "status"]);
	});

	test("no index outside a repo: skip", async () => {
		const { run } = runner([{}]);
		expect((await ensureIndex(plain, run, { autoInit: true })).action).toBe("skip");
	});

	test("a failing step reports the last line of its output, without colours", async () => {
		const { run } = runner([{}], { code: 2, stderr: "warming up\n\u001b[31mboom: locked\u001b[0m\n" });
		const r = await ensureIndex(repo, run, { autoInit: true });
		expect(r.action).toBe("init");
		expect(r.error).toBe("codegraph init failed (exit 2): boom: locked");
		const out = await ensureIndex(repo, runner([{}], { code: 1, stdout: "from stdout" }).run, { autoInit: true });
		expect(out.error).toBe("codegraph init failed (exit 1): from stdout");
	});

	test("the CLI is missing (exit 127)", async () => {
		const r = await ensureIndex(repo, async () => ({ code: 127, stdout: "", stderr: "" }), { autoInit: true });
		expect(r.action).toBe("skip");
		expect(r.status.initialized).toBe(false);
		expect(r.error).toContain("not installed");
	});
});
