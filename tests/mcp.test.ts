import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { CodeGraphServer, defaultSpawner, MAX_STDERR, sanitize, type ServerProcess, type Spawner } from "../extensions/core/mcp.ts";

type Msg = { jsonrpc: string; id?: number; method: string; params?: any };
type Answer = (msg: Msg, proc: FakeProc) => void;

/** A fake `codegraph serve --mcp`: reads JSON-RPC lines from stdin and answers through `answer`. */
class FakeProc extends EventEmitter {
	readonly stdout = new EventEmitter();
	readonly stderr = new EventEmitter();
	readonly received: Msg[] = [];
	killed = 0;
	readonly stdin = {
		write: (chunk: string) => {
			for (const line of chunk.split("\n").filter(Boolean)) {
				const msg = JSON.parse(line) as Msg;
				this.received.push(msg);
				queueMicrotask(() => this.answer(msg, this));
			}
			return true;
		},
	};
	constructor(private readonly answer: Answer) {
		super();
	}
	reply(id: number | undefined, body: Record<string, unknown>) {
		this.stdout.emit("data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id, ...body })}\n`));
	}
	kill() {
		this.killed++;
		return true;
	}
}

/** Answers initialize with an empty result and tools/call with `call`. */
const standard =
	(call: Answer): Answer =>
	(msg, proc) => {
		if (msg.method === "initialize") proc.reply(msg.id, { result: {} });
		else if (msg.method === "tools/call") call(msg, proc);
	};

function spawner(answer: Answer) {
	const procs: FakeProc[] = [];
	const spawned: { args: string[]; cwd: string }[] = [];
	const spawn: Spawner = (args, cwd) => {
		spawned.push({ args, cwd });
		const p = new FakeProc(answer);
		procs.push(p);
		return p as unknown as ServerProcess;
	};
	return { spawn, procs, spawned };
}

const echo = standard((msg, proc) => proc.reply(msg.id, { result: { content: [{ type: "text", text: `${msg.params.name}:${JSON.stringify(msg.params.arguments)}` }] } }));

describe("sanitize", () => {
	test("strips colours and secrets, trims, keeps the tail", () => {
		expect(sanitize("\u001b[31m  GITHUB_TOKEN=abc123 api_key=x Bearer xyz  \u001b[0m")).toBe("GITHUB_TOKEN=[redacted] api_key=[redacted] Bearer [redacted]");
		expect(sanitize("x".repeat(MAX_STDERR + 50)).length).toBe(MAX_STDERR);
	});
});

describe("CodeGraphServer", () => {
	test("initializes once, then calls tools", async () => {
		const { spawn, procs, spawned } = spawner(echo);
		const s = new CodeGraphServer("/work/my-repo", { watch: true, timeoutMs: 1000, spawn });
		expect(s.running).toBe(false);
		const r = await s.call("codegraph_search", { query: "foo" });
		expect(r.content![0]!.text).toBe('codegraph_search:{"query":"foo"}');
		expect(s.running).toBe(true);
		await s.call("codegraph_status", {});
		expect(spawned).toEqual([{ args: ["serve", "--mcp", "--path", "/work/my-repo"], cwd: "/work/my-repo" }]);
		const methods = procs[0]!.received.map((m) => m.method);
		expect(methods).toEqual(["initialize", "notifications/initialized", "tools/call", "tools/call"]);
		const init = procs[0]!.received[0]!.params;
		expect(init.rootUri).toBe("file:///work/my-repo");
		expect(init.workspaceFolders[0].name).toBe("my-repo");
	});

	test("without watch it passes --no-watch; a root without a name uses the root", async () => {
		const { spawn, procs, spawned } = spawner(echo);
		await new CodeGraphServer("/", { watch: false, timeoutMs: 1000, spawn }).call("x", {});
		expect(spawned[0]!.args).toEqual(["serve", "--mcp", "--path", "/", "--no-watch"]);
		expect(procs[0]!.received[0]!.params.workspaceFolders[0].name).toBe("/");
	});

	test("an error response rejects the call, with its message or the error as JSON", async () => {
		let n = 0;
		const { spawn } = spawner(standard((msg, proc) => proc.reply(msg.id, { error: n++ === 0 ? { code: -1, message: "no such tool" } : { code: 7 } })));
		const s = new CodeGraphServer("/r", { watch: true, timeoutMs: 1000, spawn });
		await expect(s.call("nope", {})).rejects.toThrow("no such tool");
		await expect(s.call("nope", {})).rejects.toThrow('{"code":7}');
	});

	test("log lines, blank lines, unknown ids and split chunks on stdout are handled", async () => {
		const { spawn } = spawner(
			standard((msg, proc) => {
				proc.stdout.emit("data", "starting watcher...\n\n");
				proc.stdout.emit("data", `${JSON.stringify({ id: 999, result: 1 })}\n${JSON.stringify({ method: "notify" })}\n`);
				const line = `${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ok" }] } })}\n`;
				proc.stdout.emit("data", line.slice(0, 10));
				proc.stdout.emit("data", line.slice(10));
			}),
		);
		const s = new CodeGraphServer("/r", { watch: true, timeoutMs: 1000, spawn });
		expect((await s.call("t", {})).content![0]!.text).toBe("ok");
	});

	test("the process exiting rejects what is pending with its stderr; the next call restarts", async () => {
		const { spawn, procs } = spawner(
			standard((_msg, proc) => {
				proc.stderr.emit("data", "fatal: database is locked TOKEN=s3cret");
				proc.emit("exit", 1);
			}),
		);
		const s = new CodeGraphServer("/r", { watch: true, timeoutMs: 1000, spawn });
		await expect(s.call("t", {})).rejects.toThrow("fatal: database is locked TOKEN=[redacted]");
		expect(s.running).toBe(false);
		await expect(s.call("t", {})).rejects.toThrow("database is locked");
		expect(procs.length).toBe(2);
	});

	test("an exit without stderr names the code; a spawn error rejects too", async () => {
		const exits = spawner(standard((_m, proc) => proc.emit("exit", 3)));
		await expect(new CodeGraphServer("/r", { watch: true, timeoutMs: 1000, spawn: exits.spawn }).call("t", {})).rejects.toThrow(
			"codegraph serve exited with code 3",
		);
		const errors = spawner((_m, proc) => proc.emit("error", new Error("spawn codegraph ENOENT")));
		await expect(new CodeGraphServer("/r", { watch: true, timeoutMs: 1000, spawn: errors.spawn }).call("t", {})).rejects.toThrow("ENOENT");
	});

	test("events from a process already replaced are ignored", async () => {
		const { spawn, procs } = spawner(echo);
		const s = new CodeGraphServer("/r", { watch: true, timeoutMs: 1000, spawn });
		await s.call("t", {});
		s.close();
		procs[0]!.emit("exit", 0);
		await s.call("t", {});
		expect(procs.length).toBe(2);
		procs[0]!.emit("error", new Error("late"));
		expect(s.running).toBe(true);
	});

	test("a timeout closes the server and the next call restarts it", async () => {
		let hang = true;
		const { spawn, procs } = spawner(standard((msg, proc) => (hang ? undefined : proc.reply(msg.id, { result: { content: [] } }))));
		const s = new CodeGraphServer("/my/root", { watch: true, timeoutMs: 20, spawn });
		await expect(s.call("t", {})).rejects.toThrow('did not answer within 0s. If this repeats, run "codegraph unlock" in /my/root.');
		expect(procs[0]!.killed).toBe(1);
		expect(s.running).toBe(false);
		hang = false;
		expect(await s.call("t", {})).toEqual({ content: [] });
		expect(procs.length).toBe(2);
	});

	test("a timeout during initialize also restarts", async () => {
		let hang = true;
		const { spawn, procs } = spawner((msg, proc) => (hang ? undefined : standard(() => proc.reply(msg.id, { result: {} }))(msg, proc)));
		const s = new CodeGraphServer("/r", { watch: true, timeoutMs: 20, spawn });
		await expect(s.call("t", {})).rejects.toThrow("did not answer");
		hang = false;
		await s.call("t", {});
		expect(procs.length).toBe(2);
	});

	test("an initialize error closes the process; the next call starts afresh", async () => {
		let fail = true;
		const { spawn, procs } = spawner((msg, proc) => {
			if (msg.method === "initialize") proc.reply(msg.id, fail ? { error: { message: "bad protocol" } } : { result: {} });
			else if (msg.method === "tools/call") proc.reply(msg.id, { result: { content: [{ type: "text", text: "ok" }] } });
		});
		const s = new CodeGraphServer("/r", { watch: true, timeoutMs: 1000, spawn });
		await expect(s.call("t", {})).rejects.toThrow("bad protocol");
		expect(procs[0]!.killed).toBe(1);
		expect(s.running).toBe(false);
		fail = false;
		expect((await s.call("t", {})).content![0]!.text).toBe("ok");
		expect(procs.length).toBe(2);
	});

	test("an abort rejects the call; a finished call removes its listener", async () => {
		const { spawn } = spawner(standard(() => undefined));
		const s = new CodeGraphServer("/r", { watch: true, timeoutMs: 5000, spawn });
		const ac = new AbortController();
		const p = s.call("t", {}, ac.signal);
		ac.abort();
		await expect(p).rejects.toThrow("Aborted");

		const ok = spawner(echo);
		const s2 = new CodeGraphServer("/r", { watch: true, timeoutMs: 5000, spawn: ok.spawn });
		const ac2 = new AbortController();
		await s2.call("t", {}, ac2.signal);
		ac2.abort(); // no listener left: nothing happens
		s.close();
	});

	test("an already aborted signal never starts the server", async () => {
		const { spawn, procs } = spawner(echo);
		const s = new CodeGraphServer("/r", { watch: true, timeoutMs: 5000, spawn });
		const ac = new AbortController();
		ac.abort();
		await expect(s.call("t", {}, ac.signal)).rejects.toThrow("Aborted");
		expect(procs.length).toBe(0);
	});

	test("an aborted request leaves nothing pending; its late answer is ignored", async () => {
		const held: { id?: number; proc: FakeProc }[] = [];
		const { spawn } = spawner(standard((msg, proc) => (msg.params.name === "slow" ? held.push({ id: msg.id, proc }) : echo(msg, proc))));
		const s = new CodeGraphServer("/r", { watch: true, timeoutMs: 5000, spawn });
		const ac = new AbortController();
		const p = s.call("slow", {}, ac.signal);
		for (let i = 0; i < 50 && held.length === 0; i++) await Bun.sleep(1);
		ac.abort();
		await expect(p).rejects.toThrow("Aborted");
		expect((s as any).pending.size).toBe(0);
		held[0]!.proc.reply(held[0]!.id, { result: { content: [{ type: "text", text: "late" }] } });
		expect((await s.call("t", {})).content![0]!.text).toBe("t:{}");
		s.close();
	});

	test("an abort while the server starts sends no request", async () => {
		let init: (() => void) | undefined;
		const { spawn, procs } = spawner((msg, proc) => {
			if (msg.method === "initialize") init = () => proc.reply(msg.id, { result: {} });
		});
		const s = new CodeGraphServer("/r", { watch: true, timeoutMs: 5000, spawn });
		const ac = new AbortController();
		const p = s.call("t", {}, ac.signal);
		for (let i = 0; i < 50 && !init; i++) await Bun.sleep(1);
		ac.abort();
		await expect(p).rejects.toThrow("Aborted");
		init!();
		await Bun.sleep(2);
		expect(procs[0]!.received.some((m) => m.method === "tools/call")).toBe(false);
		s.close();
	});

	test("close is idempotent and survives a kill that throws", async () => {
		const { spawn, procs } = spawner(echo);
		const s = new CodeGraphServer("/r", { watch: true, timeoutMs: 1000, spawn });
		s.close();
		await s.call("t", {});
		procs[0]!.kill = () => {
			throw new Error("ESRCH");
		};
		s.close();
		s.close();
		expect(s.running).toBe(false);
	});

	test("closing rejects a pending call", async () => {
		const { spawn } = spawner(standard(() => undefined));
		const s = new CodeGraphServer("/r", { watch: true, timeoutMs: 5000, spawn });
		const p = s.call("t", {});
		await Bun.sleep(5);
		s.close();
		await expect(p).rejects.toThrow("CodeGraph server closed");
	});
});

describe("defaultSpawner", () => {
	test("starts the real codegraph CLI (or reports it missing)", async () => {
		const proc = defaultSpawner(["--version"], tmpdir());
		const result = await new Promise<string>((done) => {
			proc.on("error", (e) => done(`error: ${e.message}`));
			proc.on("exit", (code) => done(`exit ${code}`));
		});
		expect(result).toMatch(/^(exit \d+|error: .+)$/);
		proc.kill();
	});
});
