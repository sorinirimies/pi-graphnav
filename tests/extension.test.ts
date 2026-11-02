import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRunner, exitCode, READ_HINT, type Status, searchesOf, statusReport, statusText } from "../extensions/codegraph.ts";
import { type Config, configPath, DEFAULT_CONFIG } from "../extensions/core/config.ts";
import type { ServerProcess, Spawner } from "../extensions/core/mcp.ts";
import type { Runner } from "../extensions/core/project.ts";
import { GUIDELINES, TOOL_NAMES } from "../extensions/core/tools.ts";
import { fakeCtx, load } from "./helpers.ts";

const READY = {
	initialized: true,
	version: "1.6.2",
	fileCount: 3,
	pendingChanges: { added: 0, modified: 0, removed: 0 },
	index: { state: "complete", builtWithVersion: "1.6.2", reindexRecommended: false },
};

/** A fake CLI: records every call; `status` answers with `status`, everything else exits with `code`. */
function fakeRun(opts: { status?: unknown; statusCode?: number; code?: number; hold?: Promise<void> } = {}) {
	const calls: string[][] = [];
	const run: Runner = async (args, cwd) => {
		calls.push([cwd, ...args]);
		if (opts.hold) await opts.hold;
		if (args[0] === "status") return { code: opts.statusCode ?? 0, stdout: JSON.stringify(opts.status ?? READY), stderr: "" };
		return { code: opts.code ?? 0, stdout: "", stderr: opts.code ? "boom" : "" };
	};
	return { run, calls, args: () => calls.map((c) => c.slice(1).join(" ")) };
}

/** A fake `codegraph serve --mcp`: answers initialize, and tools/call with its own params (or an error for query "fail"). */
function fakeSpawn() {
	const spawned: { args: string[]; proc: EventEmitter & { killed: number } }[] = [];
	const spawn: Spawner = (args) => {
		const proc = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(),
			stderr: new EventEmitter(),
			killed: 0,
			kill() {
				proc.killed++;
			},
			stdin: {
				write(line: string) {
					const msg = JSON.parse(line);
					const reply = (body: unknown) => queueMicrotask(() => proc.stdout.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...(body as object) })}\n`));
					if (msg.method === "initialize") reply({ result: {} });
					else if (msg.method === "tools/call")
						reply({
							result:
								msg.params.arguments.query === "fail"
									? { isError: true, content: [{ type: "text", text: "bad query" }] }
									: { content: [{ type: "text", text: JSON.stringify(msg.params) }] },
						});
				},
			},
		});
		spawned.push({ args, proc });
		return proc as unknown as ServerProcess;
	};
	return { spawn, spawned };
}

const repo = () => {
	const dir = mkdtempSync(join(tmpdir(), "cg-repo-"));
	mkdirSync(join(dir, ".git"));
	mkdirSync(join(dir, "src"));
	return dir;
};
const plainDir = () => mkdtempSync(join(tmpdir(), "cg-plain-"));

async function until(cond: () => boolean, what: string) {
	for (let i = 0; i < 1000; i++) {
		if (cond()) return;
		await Bun.sleep(1);
	}
	throw new Error(`timed out waiting for ${what}`);
}

/** Load the extension with fakes and start a session in `cwd` (a fresh repo by default), waiting for indexing. */
async function start(opts: { config?: Partial<Config>; run?: ReturnType<typeof fakeRun>; cwd?: string; wait?: boolean } = {}) {
	if (opts.config) writeFileSync(configPath(), JSON.stringify(opts.config));
	else rmSync(configPath(), { force: true });
	const runner = opts.run ?? fakeRun();
	const server = fakeSpawn();
	const ext = load({ run: runner.run, spawn: server.spawn });
	const cwd = opts.cwd ?? repo();
	const ctx = fakeCtx(cwd);
	await ext.hooks.session_start!({}, ctx);
	if (opts.wait !== false) await until(() => !/checking|indexing/.test(ctx.status.codegraph ?? ""), "indexing");
	const cmd = (args: string) => ext.commands.codegraph!.handler(args, ctx);
	const call = (toolName: string, input: unknown, toolCallId = "c1") => ext.hooks.tool_call!({ toolName, input, toolCallId }, ctx);
	const result = (toolName: string, input: unknown, content?: unknown[], toolCallId = "c1") =>
		ext.hooks.tool_result!({ toolName, input, content, toolCallId }, ctx);
	const exec = (name: string, params: Record<string, unknown>, signal?: AbortSignal) => ext.tools[name]!.execute("id", params, signal, undefined, ctx);
	return { ...ext, ctx, runner, server, cwd, cmd, call, result, exec };
}

afterEach(() => {
	rmSync(configPath(), { force: true });
});

const status = (o: Partial<Status>): Status => ({ config: DEFAULT_CONFIG, state: "none", blocked: 0, nudged: 0, ...o });

describe("status text", () => {
	test("statusText: off, state, files when ready, mode", () => {
		expect(statusText(status({ config: { ...DEFAULT_CONFIG, enabled: false } }))).toBe("codegraph: off");
		const index = { initialized: true, state: "complete", files: 7, pending: 2, reindexRecommended: false, versionMismatch: false };
		expect(statusText(status({ state: "ready", index }))).toBe("codegraph: ready · 7 files · enforce");
		expect(statusText(status({ state: "error", index }))).toBe("codegraph: error · enforce");
		expect(statusText(status({ state: "ready" }))).toBe("codegraph: ready · enforce");
	});

	test("statusReport: project, index, counts and the last error", () => {
		const index = { initialized: true, state: "complete", files: 7, pending: 2, reindexRecommended: false, versionMismatch: false };
		expect(statusReport(status({ state: "ready", index, project: { root: "/r", hasIndexDir: true, isRepo: true }, blocked: 1, nudged: 2, error: "x" }))).toBe(
			["codegraph: ready · 7 files · enforce", "project: /r", "index: complete, 7 files, 2 pending changes", "this session: 1 searches blocked, 2 nudged", "last error: x"].join("\n"),
		);
		expect(statusReport(status({}))).toContain("project: (none: not in a git repo or indexed directory)");
		expect(statusReport(status({})).split("\n").length).toBe(3);
	});
});

describe("searchesOf", () => {
	test("bash and powershell commands, pi's grep tool, nothing else", () => {
		expect(searchesOf("bash", { command: "rg Foo src" })).toEqual([{ tool: "rg", pattern: "Foo", paths: ["src"], filters: [] }]);
		expect(searchesOf("powershell", { command: "rg Foo" }).length).toBe(1);
		expect(searchesOf("bash", { command: 5 })).toEqual([]);
		expect(searchesOf("grep", { pattern: "Foo", path: "src", glob: "*.ts" })).toEqual([{ tool: "grep", pattern: "Foo", paths: ["src"], filters: ["*.ts"] }]);
		expect(searchesOf("grep", { pattern: "Foo" })).toEqual([{ tool: "grep", pattern: "Foo", paths: [], filters: [] }]);
		expect(searchesOf("grep", {})).toEqual([]);
		expect(searchesOf("read", { path: "a.ts" })).toEqual([]);
	});
});

describe("registration", () => {
	test("hooks, the command and the eight tools", () => {
		const { hooks, commands, tools } = load();
		expect(Object.keys(hooks).sort()).toEqual(["before_agent_start", "session_shutdown", "session_start", "tool_call", "tool_result"]);
		expect(Object.keys(commands)).toEqual(["codegraph"]);
		expect(Object.keys(tools)).toEqual([...TOOL_NAMES]);
		for (const t of Object.values(tools)) {
			expect(t.label.length).toBeGreaterThan(0);
			expect(t.promptSnippet.length).toBeGreaterThan(0);
			expect(t.parameters).toBeDefined();
		}
	});

	test("the command completes its arguments", () => {
		expect(load().commands.codegraph!.getArgumentCompletions("mode e")!.map((c) => c.value)).toEqual(["mode enforce"]);
	});
});

describe("session_start", () => {
	test("an up-to-date index: one status call, then ready", async () => {
		const s = await start();
		expect(s.runner.calls).toEqual([[s.cwd, "status", "-j"]]);
		expect(s.ctx.status.codegraph).toBe("codegraph: ready · 3 files · enforce");
		expect(s.ctx.notes).toEqual([]);
	});

	test("pending changes are synced", async () => {
		const s = await start({ run: fakeRun({ status: { ...READY, pendingChanges: { added: 1 } } }) });
		expect(s.runner.args()).toEqual(["status -j", "sync -q", "status -j"]);
	});

	test("without autoSync only the status is read", async () => {
		const s = await start({ config: { autoSync: false }, run: fakeRun({ status: { ...READY, pendingChanges: { added: 1 } } }) });
		expect(s.runner.args()).toEqual(["status -j"]);
		expect(s.ctx.status.codegraph).toBe("codegraph: ready · 3 files · enforce");
	});

	test("no index and no autoInit: missing", async () => {
		const s = await start({ config: { autoInit: false }, run: fakeRun({ status: {} }) });
		expect(s.ctx.status.codegraph).toBe("codegraph: missing · enforce");
	});

	test("the CLI not installed: error, explained by /codegraph status", async () => {
		const s = await start({ run: fakeRun({ statusCode: 127 }) });
		expect(s.ctx.status.codegraph).toBe("codegraph: error · enforce");
		await s.cmd("status");
		expect(s.ctx.notes[0]![0]).toContain("last error: the codegraph CLI is not installed");
	});

	test("no project: nothing runs", async () => {
		const s = await start({ cwd: plainDir() });
		expect(s.runner.calls).toEqual([]);
		expect(s.ctx.status.codegraph).toBe("codegraph: none · enforce");
	});

	test("disabled: nothing runs, no status line", async () => {
		const s = await start({ config: { enabled: false } });
		expect(s.runner.calls).toEqual([]);
		expect(s.ctx.status.codegraph).toBe("");
	});

	test("showStatus off hides the status line", async () => {
		const s = await start({ config: { showStatus: false }, wait: false });
		await Bun.sleep(5);
		expect(s.ctx.status.codegraph).toBe("");
	});

	test("a broken config file is reported, the defaults apply", async () => {
		writeFileSync(configPath(), "{ nope");
		const ext = load({ run: fakeRun().run, spawn: fakeSpawn().spawn });
		const ctx = fakeCtx(plainDir());
		await ext.hooks.session_start!({}, ctx);
		expect(ctx.notes[0]![0]).toContain("is not valid JSON; using the defaults");
		expect(ctx.notes[0]![1]).toBe("warning");
	});

	test("a session in another project waits for the running job, then indexes its own", async () => {
		let release!: () => void;
		const run = fakeRun({ hold: new Promise<void>((r) => (release = r)) });
		const s = await start({ run, wait: false });
		const other = repo();
		await s.hooks.session_start!({}, { ...s.ctx, cwd: other });
		release();
		await until(() => /ready/.test(s.ctx.status.codegraph ?? ""), "the second project");
		expect(run.calls.some((c) => c[0] === other)).toBe(true);
	});

	test("/codegraph on after a disabled start indexes", async () => {
		const s = await start({ config: { enabled: false } });
		expect(s.runner.calls).toEqual([]);
		await s.cmd("on");
		await until(() => /ready/.test(s.ctx.status.codegraph ?? ""), "indexing after on");
		expect(s.runner.args()).toContain("status -j");
	});

	test("an index job finishing after the project changed is dropped", async () => {
		let release!: () => void;
		const run = fakeRun({ hold: new Promise<void>((r) => (release = r)) });
		const s = await start({ run, wait: false });
		expect(s.ctx.status.codegraph).toBe("codegraph: indexing · enforce");
		await s.hooks.session_start!({}, { ...s.ctx, cwd: plainDir() });
		release();
		await Bun.sleep(5);
		expect(s.ctx.status.codegraph).toBe("codegraph: none · enforce");
	});
});

describe("gate", () => {
	const search = { command: "rg -n parseConfig src" };

	test("enforce blocks a symbol search once, the identical call then runs", async () => {
		const s = await start();
		const first = await s.call("bash", search);
		expect(first.block).toBe(true);
		expect(first.reason).toContain('"parseConfig" looks like a symbol');
		expect(await s.call("bash", search)).toBeUndefined();
		await s.cmd("status");
		expect(s.ctx.notes[0]![0]).toContain("1 searches blocked, 0 nudged");
	});

	test("pi's grep tool is gated too", async () => {
		const s = await start();
		expect((await s.call("grep", { pattern: "parseConfig", path: "src" })).block).toBe(true);
	});

	test("other tools, text searches and non-code targets pass", async () => {
		const s = await start();
		expect(await s.call("read", { path: "src/a.ts" })).toBeUndefined();
		expect(await s.call("bash", undefined)).toBeUndefined();
		expect(await s.call("bash", { command: "rg 'hello world' src" })).toBeUndefined();
		expect(await s.call("bash", { command: "rg foo README.md" })).toBeUndefined();
	});

	test("a symbol already looked up with CodeGraph passes", async () => {
		const s = await start();
		await s.exec("codegraph_search", { query: "parseConfig" });
		expect(await s.call("bash", search)).toBeUndefined();
	});

	test("nudge lets it run and appends a hint to its result", async () => {
		const s = await start({ config: { mode: "nudge" } });
		expect(await s.call("bash", search, "n1")).toBeUndefined();
		const out = await s.result("bash", search, [{ type: "text", text: "src/a.ts:1:parseConfig" }], "n1");
		expect(out.content[0]).toEqual({ type: "text", text: "src/a.ts:1:parseConfig" });
		expect(out.content[1].text).toStartWith("\n[codegraph] ");
		expect(await s.result("bash", search, undefined, "n1")).toBeUndefined(); // the hint is used once
		await s.call("bash", search, "n2");
		expect((await s.result("bash", search, undefined, "n2")).content.length).toBe(1);
		await s.cmd("status");
		expect(s.ctx.notes[0]![0]).toContain("0 searches blocked, 2 nudged");
	});

	test("mode off, a disabled extension and an index that is not ready let everything pass", async () => {
		const off = await start({ config: { mode: "off" } });
		expect(await off.call("bash", search)).toBeUndefined();

		const disabled = await start();
		await disabled.cmd("off");
		expect(await disabled.call("bash", search)).toBeUndefined();

		let release!: () => void;
		const busy = await start({ run: fakeRun({ hold: new Promise<void>((r) => (release = r)) }), wait: false });
		expect(await busy.call("bash", search)).toBeUndefined();
		release();
	});
});

describe("read hint", () => {
	test("after readHintAfter source reads without CodeGraph, once", async () => {
		const s = await start({ config: { readHintAfter: 2 } });
		expect(await s.result("read", { path: "src/a.ts" }, [])).toBeUndefined();
		expect(await s.result("read", { path: "README.md" }, [])).toBeUndefined();
		expect(await s.result("read", {}, [])).toBeUndefined();
		expect(await s.result("bash", { path: "src/b.ts" }, [])).toBeUndefined();
		const out = await s.result("read", { path: "src/b.ts" }, [{ type: "text", text: "code" }]);
		expect(out.content[1]).toEqual({ type: "text", text: `\n${READ_HINT}` });
		expect(await s.result("read", { path: "src/c.ts" }, [])).toBeUndefined();
	});

	test("not after a CodeGraph call, never for CodeGraph's own results, never with 0", async () => {
		const s = await start({ config: { readHintAfter: 1 } });
		expect(await s.result("codegraph_search", {}, [])).toBeUndefined();
		await s.exec("codegraph_status", {});
		expect(await s.result("read", { path: "src/a.ts" }, [])).toBeUndefined();

		const never = await start({ config: { readHintAfter: 0 } });
		for (const f of ["a", "b", "c", "d"]) expect(await never.result("read", { path: `src/${f}.ts` }, [])).toBeUndefined();
	});
});

describe("tools", () => {
	test("execute calls the project's server with projectPath and returns the text", async () => {
		const s = await start();
		const out = await s.exec("codegraph_search", { query: "parseConfig" });
		expect(JSON.parse(out.content[0].text)).toEqual({ name: "codegraph_search", arguments: { query: "parseConfig", projectPath: s.cwd } });
		expect(out.details).toEqual({ root: s.cwd });
		expect(s.server.spawned.map((x) => x.args)).toEqual([["serve", "--mcp", "--path", s.cwd]]);
		await s.exec("codegraph_node", { symbol: "x" });
		expect(s.server.spawned.length).toBe(1); // one long-lived server per project
	});

	test("watch off starts the server without its watcher", async () => {
		const s = await start({ config: { watch: false } });
		await s.exec("codegraph_status", {});
		expect(s.server.spawned[0]!.args).toContain("--no-watch");
	});

	test("codegraph_files gets a root-relative path", async () => {
		const s = await start();
		const args = async (params: Record<string, unknown>) => JSON.parse((await s.exec("codegraph_files", params)).content[0].text).arguments;
		expect((await args({ path: join(s.cwd, "src", "core") })).path).toBe("src/core");
		expect(await args({ path: s.cwd })).toEqual({ projectPath: s.cwd });
		expect(await args({})).toEqual({ projectPath: s.cwd });
	});

	test("projectPath picks another project, relative to cwd", async () => {
		const s = await start();
		const other = repo();
		const out = await s.exec("codegraph_status", { projectPath: join(other, "src") });
		expect(out.details.root).toBe(other);
		const plain = plainDir();
		expect((await s.exec("codegraph_status", { projectPath: plain })).details.root).toBe(plain);
		expect((await s.exec("codegraph_status", { projectPath: "src" })).details.root).toBe(s.cwd);
		expect((await s.exec("codegraph_status", { projectPath: "  " })).details.root).toBe(s.cwd);
		expect(s.server.spawned.length).toBe(3);
	});

	test("without a session the project comes from cwd; with none at all it throws", async () => {
		const cwd = repo();
		const ext = load({ run: fakeRun().run, spawn: fakeSpawn().spawn });
		expect((await ext.tools.codegraph_status!.execute("id", {}, undefined, undefined, { cwd })).details.root).toBe(cwd);
		await expect(ext.tools.codegraph_status!.execute("id", {}, undefined, undefined, { cwd: plainDir() })).rejects.toThrow("No project");
	});

	test("an error result throws its text", async () => {
		const s = await start();
		await expect(s.exec("codegraph_explore", { query: "fail" })).rejects.toThrow("bad query");
	});

	test("while the project is indexing the tools say so", async () => {
		let release!: () => void;
		const s = await start({ run: fakeRun({ hold: new Promise<void>((r) => (release = r)) }), wait: false });
		await expect(s.exec("codegraph_search", { query: "x" })).rejects.toThrow("still building the index");
		release();
		await until(() => s.ctx.status.codegraph!.includes("ready"), "ready");
		expect((await s.exec("codegraph_search", { query: "x" })).details.root).toBe(s.cwd);
	});

	test("session_shutdown closes the servers; the next call starts a new one", async () => {
		const s = await start();
		await s.exec("codegraph_status", {});
		await s.hooks.session_shutdown!({}, s.ctx);
		expect(s.server.spawned[0]!.proc.killed).toBe(1);
		await s.exec("codegraph_status", {});
		expect(s.server.spawned.length).toBe(2);
	});
});

describe("before_agent_start", () => {
	test("adds the guidelines once", async () => {
		const s = await start();
		const event = { systemPromptOptions: { promptGuidelines: ["mine"] } };
		await s.hooks.before_agent_start!(event, s.ctx);
		await s.hooks.before_agent_start!(event, s.ctx);
		expect(event.systemPromptOptions.promptGuidelines).toEqual(["mine", ...GUIDELINES]);
		await s.hooks.before_agent_start!({}, s.ctx); // no guidelines array: nothing to do
		await s.hooks.before_agent_start!(undefined, s.ctx);
	});

	test("nothing when disabled", async () => {
		const s = await start({ config: { enabled: false } });
		const event = { systemPromptOptions: { promptGuidelines: [] as string[] } };
		await s.hooks.before_agent_start!(event, s.ctx);
		expect(event.systemPromptOptions.promptGuidelines).toEqual([]);
	});
});

describe("defaultRunner", () => {
	test.skipIf(!Bun.which("codegraph"))("runs the real CLI", async () => {
		const r = await defaultRunner(["--version"], tmpdir());
		expect(r.code).toBe(0);
		expect(r.stdout.trim()).toMatch(/\d+\.\d+/);
	});

	test.skipIf(process.platform === "win32")("collects stdout, stderr and the exit code (a stand-in CLI on PATH)", async () => {
		const bin = plainDir();
		writeFileSync(join(bin, "codegraph"), '#!/bin/sh\necho "out $1"\necho "err $2" >&2\nexit 3\n', { mode: 0o755 });
		const path = process.env.PATH;
		process.env.PATH = `${bin}:${path}`;
		try {
			expect(await defaultRunner(["a", "b"], tmpdir())).toEqual({ code: 3, stdout: "out a\n", stderr: "err b\n" });
		} finally {
			process.env.PATH = path;
		}
	});

	test("exitCode: a shell's \"not found\" is 127, anything else passes through", () => {
		expect(exitCode(9009, "")).toBe(127);
		expect(exitCode(1, "'codegraph' is not recognized as an internal or external command,")).toBe(127);
		expect(exitCode(127, "sh: codegraph: command not found")).toBe(127);
		expect(exitCode(0, "command not found")).toBe(0);
		expect(exitCode(2, "boom")).toBe(2);
		expect(exitCode(null, "")).toBe(1);
	});

	test("a missing CLI exits with 127", async () => {
		const path = process.env.PATH;
		process.env.PATH = plainDir();
		try {
			const r = await defaultRunner(["--version"], tmpdir());
			expect(r.code).toBe(127);
			expect(r.stderr.length).toBeGreaterThan(0);
		} finally {
			process.env.PATH = path;
		}
	});

	test("another spawn error exits with 1", async () => {
		const r = await defaultRunner(["--version"], join(plainDir(), "missing-cwd"));
		expect(r.code).not.toBe(0);
	});
});

describe("/codegraph", () => {
	test("status, with and without a project", async () => {
		const s = await start();
		await s.cmd("");
		expect(s.ctx.notes[0]).toEqual([
			`codegraph: ready · 3 files · enforce\nproject: ${s.cwd}\nindex: complete, 3 files, 0 pending changes\nthis session: 0 searches blocked, 0 nudged`,
			"info",
		]);
		const none = await start({ cwd: plainDir() });
		await none.cmd("status");
		expect(none.ctx.notes[0]![0]).toContain("project: (none");
	});

	test("on, off and mode change the setting, save it and update the status line", async () => {
		const s = await start();
		await s.cmd("off");
		expect(s.ctx.status.codegraph).toBe("");
		expect(JSON.parse(readFileSync(configPath(), "utf8")).enabled).toBe(false);
		expect(s.ctx.notes.at(-1)).toEqual(["codegraph off", "info"]);
		await s.cmd("on");
		expect(s.ctx.status.codegraph).toBe("codegraph: ready · 3 files · enforce");
		await s.cmd("mode nudge");
		expect(s.ctx.status.codegraph).toBe("codegraph: ready · 3 files · nudge");
		expect(s.ctx.notes.at(-1)).toEqual(["codegraph: mode nudge", "info"]);
		expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual({ ...DEFAULT_CONFIG, mode: "nudge" });

		const fresh = await start({ config: JSON.parse(readFileSync(configPath(), "utf8")) });
		expect(fresh.ctx.status.codegraph).toBe("codegraph: ready · 3 files · nudge");
	});

	test("sync, reindex and init run the CLI and report", async () => {
		const s = await start();
		for (const c of ["sync", "reindex", "init"]) await s.cmd(c);
		expect(s.runner.args()).toEqual(["status -j", "sync -q", "status -j", "index -q", "status -j", "init -i -y", "status -j"]);
		expect(s.ctx.notes[0]).toEqual([`codegraph: sync started for ${s.cwd}`, "info"]);
		expect(s.ctx.notes[1]![0]).toStartWith("codegraph: ready · 3 files");
		expect(s.ctx.notes[2]![0]).toBe(`codegraph: index started for ${s.cwd}`);
	});

	test("a failing or missing CLI is reported", async () => {
		const failing = await start({ run: fakeRun({ code: 2 }) });
		await failing.cmd("sync");
		expect(failing.ctx.notes.at(-1)).toEqual(["codegraph: codegraph sync failed (exit 2)", "warning"]);
		expect(failing.ctx.status.codegraph).toBe("codegraph: error · enforce");

		const missing = await start({ run: fakeRun({ code: 127 }) });
		await missing.cmd("reindex");
		expect(missing.ctx.notes.at(-1)![0]).toContain("not installed");
	});

	test("no project: sync warns, init indexes the directory (never home)", async () => {
		const s = await start({ cwd: plainDir() });
		await s.cmd("sync");
		expect(s.ctx.notes[0]).toEqual(["codegraph: no project here (not inside a git repo or an indexed directory)", "warning"]);
		await s.cmd("init");
		expect(s.runner.args()).toEqual(["init -i -y", "status -j"]);
		expect(s.ctx.notes[1]).toEqual([`codegraph: init started for ${s.cwd}`, "info"]);

		const home = load({ run: fakeRun().run });
		const ctx = fakeCtx(homedir());
		await home.commands.codegraph!.handler("init", ctx);
		expect(ctx.notes[0]![1]).toBe("warning");
	});

	test("invalid arguments print the usage", async () => {
		const s = await start();
		await s.cmd("bogus");
		await s.cmd("mode loud");
		expect(s.ctx.notes.map((n) => n[1])).toEqual(["warning", "warning"]);
		expect(s.ctx.notes[0]![0]).toContain("Usage: /codegraph");
	});

	test("a save that fails is reported and the setting still applies", async () => {
		const s = await start();
		const dir = process.env.PI_CODING_AGENT_DIR;
		const file = join(plainDir(), "not-a-dir");
		writeFileSync(file, "a file where the directory should be");
		process.env.PI_CODING_AGENT_DIR = file;
		try {
			await s.cmd("mode off");
		} finally {
			process.env.PI_CODING_AGENT_DIR = dir;
		}
		expect(s.ctx.notes[0]![0]).toContain("could not save the setting");
		expect(s.ctx.notes[0]![1]).toBe("warning");
		expect(s.ctx.status.codegraph).toBe("codegraph: ready · 3 files · off");
	});

});
