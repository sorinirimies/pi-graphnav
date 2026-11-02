/**
 * A long-lived `codegraph serve --mcp` process per project, spoken to over stdio (JSON-RPC 2.0,
 * one message per line).
 *
 * Long-lived on purpose: the server's file watcher keeps the index in sync while pi runs,
 * and no call pays for a process start. A call that times out kills the process; the next
 * call starts a fresh one.
 */
import { type ChildProcessWithoutNullStreams, spawn as nodeSpawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/** The part of a child process the client uses (so tests can pass a fake). */
export interface ServerProcess {
	stdin: { write(chunk: string): unknown };
	stdout: { on(event: "data", fn: (chunk: Buffer | string) => void): unknown };
	stderr: { on(event: "data", fn: (chunk: Buffer | string) => void): unknown };
	on(event: "exit", fn: (code: number | null) => void): unknown;
	on(event: "error", fn: (err: Error) => void): unknown;
	kill(): unknown;
}

export type Spawner = (args: string[], cwd: string) => ServerProcess;

export const defaultSpawner: Spawner = (args, cwd) =>
	nodeSpawn("codegraph", args, {
		cwd,
		env: process.env,
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
		// npm installs a .cmd shim on Windows, which only a shell resolves.
		shell: process.platform === "win32",
	}) as ChildProcessWithoutNullStreams;

export interface McpResult {
	content?: { type: string; text?: string }[];
	isError?: boolean;
}

export const MAX_STDERR = 2000;

/** Remove ANSI colours and anything that looks like a secret from server diagnostics. */
export function sanitize(text: string): string {
	return text
		.replace(/\u001b\[[0-9;]*m/g, "")
		.replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|APIKEY)[A-Z0-9_]*=)\S+/gi, "$1[redacted]")
		.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
		.trim()
		.slice(-MAX_STDERR);
}

interface Pending {
	resolve: (v: any) => void;
	reject: (e: Error) => void;
}

export class CodeGraphServer {
	private proc?: ServerProcess;
	private ready?: Promise<void>;
	private pending = new Map<number, Pending>();
	private nextId = 1;
	private buffer = "";
	private stderr = "";

	constructor(
		readonly root: string,
		private readonly opts: { watch: boolean; timeoutMs: number; spawn?: Spawner },
	) {}

	get running(): boolean {
		return this.proc !== undefined;
	}

	private start(): Promise<void> {
		const args = ["serve", "--mcp", "--path", this.root, ...(this.opts.watch ? [] : ["--no-watch"])];
		const proc = (this.opts.spawn ?? defaultSpawner)(args, this.root);
		this.proc = proc;
		this.buffer = "";
		this.stderr = "";
		proc.stdout.on("data", (chunk) => this.onData(String(chunk)));
		proc.stderr.on("data", (chunk) => {
			this.stderr = (this.stderr + String(chunk)).slice(-MAX_STDERR);
		});
		proc.on("error", (err) => this.fail(proc, err));
		proc.on("exit", (code) => this.fail(proc, new Error(sanitize(this.stderr) || `codegraph serve exited with code ${code}`)));
		const rootUri = pathToFileURL(this.root).href;
		return this.request("initialize", {
			protocolVersion: "2024-11-05",
			rootUri,
			workspaceFolders: [{ uri: rootUri, name: this.root.split(/[\\/]/).pop() || this.root }],
			capabilities: {},
			clientInfo: { name: "pi-codegraph", version: "1" },
		}).then(() => {
			this.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
		});
	}

	/** The process died or could not start: fail what waits on it and forget it. */
	private fail(proc: ServerProcess, err: Error) {
		if (this.proc !== proc) return;
		this.proc = undefined;
		this.ready = undefined;
		for (const p of this.pending.values()) p.reject(err);
		this.pending.clear();
	}

	private onData(chunk: string) {
		this.buffer += chunk;
		let nl: number;
		while ((nl = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, nl).trim();
			this.buffer = this.buffer.slice(nl + 1);
			if (!line) continue;
			let msg: any;
			try {
				msg = JSON.parse(line);
			} catch {
				continue; // a log line on stdout
			}
			const p = typeof msg?.id === "number" ? this.pending.get(msg.id) : undefined;
			if (!p) continue;
			this.pending.delete(msg.id);
			if (msg.error) p.reject(new Error(String(msg.error.message ?? JSON.stringify(msg.error))));
			else p.resolve(msg.result);
		}
	}

	private send(payload: unknown) {
		this.proc?.stdin.write(`${JSON.stringify(payload)}\n`);
	}

	private request(method: string, params: unknown): Promise<any> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.send({ jsonrpc: "2.0", id, method, params });
		});
	}

	/** Call a CodeGraph tool. Times out after `timeoutMs` (the process is then restarted on the next call). */
	async call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpResult> {
		if (signal?.aborted) throw new Error("Aborted");
		this.ready ??= this.start().catch((e: unknown) => {
			this.close();
			throw e;
		});
		let timer: ReturnType<typeof setTimeout> | undefined;
		let onAbort: (() => void) | undefined;
		let id: number | undefined;
		const guard = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				this.close();
				reject(new Error(`CodeGraph did not answer within ${Math.round(this.opts.timeoutMs / 1000)}s. If this repeats, run "codegraph unlock" in ${this.root}.`));
			}, this.opts.timeoutMs);
			onAbort = () => reject(new Error("Aborted"));
			signal?.addEventListener("abort", onAbort, { once: true });
		});
		try {
			const answer = this.ready.then(() => {
				if (signal?.aborted) throw new Error("Aborted");
				id = this.nextId;
				return this.request("tools/call", { name, arguments: args });
			});
			return await Promise.race([answer, guard]);
		} finally {
			// An abandoned request (timeout, abort) must not wait in `pending` for an answer nobody reads.
			if (id !== undefined) this.pending.delete(id);
			clearTimeout(timer);
			if (onAbort) signal?.removeEventListener("abort", onAbort);
		}
	}

	/** Stop the process. Idempotent. */
	close() {
		const proc = this.proc;
		if (!proc) return;
		this.fail(proc, new Error("CodeGraph server closed"));
		try {
			proc.kill();
		} catch {
			// already gone
		}
	}
}
