/**
 * pi-codegraph: CodeGraph-first code navigation for pi.
 *
 * - keeps the project's index current (init/index/sync at session start, then the server's watcher);
 * - registers the codegraph_* tools on one long-lived server per project;
 * - steers symbol searches done with rg/grep to those tools (enforce, nudge or off);
 * - hints at CodeGraph when the agent reads source file after source file without it.
 *
 * Pure logic lives in core/ and command/ (tested directly). This file wires it to pi.
 * Settings persist in <agent dir>/codegraph.json.
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { completions, parseCommand } from "./command/parse.ts";
import { type Config, DEFAULT_CONFIG, readConfig, saveConfig } from "./core/config.ts";
import { decide, findSearches, type GateMemory, isSourceFile, lookupWords, newMemory, type Search } from "./core/gate.ts";
import { CodeGraphServer, type Spawner } from "./core/mcp.ts";
import { actionArgs, ensureIndex, findProject, type IndexStatus, type Project, parseStatus, type Runner } from "./core/project.ts";
import { GUIDELINES, isCodeGraphTool, normalizeFilesPath, resultText, TOOLS } from "./core/tools.ts";

export type IndexState = "none" | "checking" | "indexing" | "ready" | "missing" | "error";

export interface Status {
	config: Config;
	project?: Project;
	state: IndexState;
	index?: IndexStatus;
	blocked: number;
	nudged: number;
	error?: string;
}

export function statusText(s: Status): string {
	if (!s.config.enabled) return "codegraph: off";
	const files = s.index && s.state === "ready" ? ` · ${s.index.files} files` : "";
	return `codegraph: ${s.state}${files} · ${s.config.mode}`;
}

export function statusReport(s: Status): string {
	return [
		statusText(s),
		`project: ${s.project?.root ?? "(none: not in a git repo or indexed directory)"}`,
		s.index ? `index: ${s.index.state}, ${s.index.files} files, ${s.index.pending} pending changes` : undefined,
		`this session: ${s.blocked} searches blocked, ${s.nudged} nudged`,
		s.error ? `last error: ${s.error}` : undefined,
	]
		.filter(Boolean)
		.join("\n");
}

/** On Windows the CLI runs through a shell, which reports a missing program itself: map that to 127 too. */
export function exitCode(code: number | null, stderr: string): number {
	if (code === 9009 || (code !== 0 && /is not recognized as an internal or external command|command not found/i.test(stderr))) return 127;
	return code ?? 1;
}

/** Runs the CodeGraph CLI. Exit code 127 means it is not installed. */
export const defaultRunner: Runner = (args, cwd) =>
	new Promise((done) => {
		let stdout = "";
		let stderr = "";
		const child = spawn("codegraph", args, { cwd, env: process.env, windowsHide: true, shell: process.platform === "win32" });
		child.stdout?.on("data", (c) => (stdout += String(c)));
		child.stderr?.on("data", (c) => (stderr += String(c)));
		child.on("error", (e: NodeJS.ErrnoException) => done({ code: e.code === "ENOENT" ? 127 : 1, stdout, stderr: stderr || e.message }));
		child.on("close", (code) => done({ code: exitCode(code, stderr), stdout, stderr }));
	});

/** The searches a tool call performs, if it is one the gate looks at. */
export function searchesOf(toolName: string, input: Record<string, unknown>): Search[] {
	if ((toolName === "bash" || toolName === "powershell") && typeof input.command === "string") return findSearches(input.command);
	if (toolName === "grep" && typeof input.pattern === "string") {
		return [
			{
				tool: "grep",
				pattern: input.pattern,
				paths: typeof input.path === "string" ? [input.path] : [],
				filters: typeof input.glob === "string" ? [input.glob] : [],
			},
		];
	}
	return [];
}

export const READ_HINT =
	"[codegraph] Several source files read without CodeGraph. codegraph_explore returns the relevant symbols' source and the call paths between them in one call; codegraph_callers/codegraph_impact show relations.";

/** Seams for tests: the CLI runner and the server process. */
export interface Deps {
	run?: Runner;
	spawn?: Spawner;
}

export function createExtension(deps: Deps = {}) {
	const run = deps.run ?? defaultRunner;
	return function (pi: ExtensionAPI) {
		let config: Config = { ...DEFAULT_CONFIG };
		let project: Project | undefined;
		let state: IndexState = "none";
		let index: IndexStatus | undefined;
		let lastError: string | undefined;
		let mem: GateMemory = newMemory();
		let counts = { blocked: 0, nudged: 0 };
		let sourceReads = 0;
		let usedCodeGraph = false;
		let readHinted = false;
		const nudges = new Map<string, string>();
		const servers = new Map<string, CodeGraphServer>();
		let job: Promise<void> | undefined;
		let jobRoot: string | undefined;
		let ui: { setStatus(key: string, text: string): void } | undefined;

		const snapshot = (): Status => ({ config, project, state, index, error: lastError, ...counts });
		const refresh = () => ui?.setStatus("codegraph", config.enabled && config.showStatus ? statusText(snapshot()) : "");

		const server = (root: string) => {
			let s = servers.get(root);
			if (!s) {
				s = new CodeGraphServer(root, { watch: config.watch, timeoutMs: config.timeoutMs, spawn: deps.spawn });
				servers.set(root, s);
			}
			return s;
		};
		const closeAll = () => {
			for (const s of servers.values()) s.close();
			servers.clear();
		};

		/** Run an index job for the current project; one at a time. */
		const indexJob = (fn: (p: Project) => Promise<{ status: IndexStatus; error?: string }>): Promise<void> => {
			const p = project;
			if (!p) return Promise.resolve();
			// A job for another project (the session moved on): run after it, for the current one.
			if (job && jobRoot !== p.root) return job.then(() => indexJob(fn));
			if (job) return job;
			jobRoot = p.root;
			state = "indexing";
			refresh();
			job = fn(p)
				.then(({ status, error }) => {
					if (project?.root !== p.root) return;
					index = status;
					lastError = error;
					state = error ? "error" : status.initialized ? "ready" : "missing";
				})
				.finally(() => {
					job = undefined;
					refresh();
				});
			return job;
		};

		const runAction = (action: "init" | "index" | "sync") =>
			indexJob(async (p) => {
				const res = await run(actionArgs(action), p.root);
				const status = parseStatus((await run(["status", "-j"], p.root)).stdout);
				const error =
					res.code === 127 ? "the codegraph CLI is not installed (npm i -g @colbymchenry/codegraph)" : res.code !== 0 ? `codegraph ${action} failed (exit ${res.code})` : undefined;
				return { status, error };
			});

		/** Bring the index up to date in the background: a first index of a big repo takes minutes. */
		const startIndexing = () =>
			void indexJob((p) =>
				config.autoSync
					? ensureIndex(p, run, { autoInit: config.autoInit })
					: run(["status", "-j"], p.root).then((r) => ({ status: parseStatus(r.stdout) })),
			);

		pi.on("session_start", async (_event, ctx) => {
			const { config: loaded, problem } = await readConfig();
			config = loaded;
			ui = ctx.ui;
			if (problem) ctx.ui.notify(`codegraph: ${problem}; using the defaults`, "warning");
			closeAll();
			mem = newMemory();
			counts = { blocked: 0, nudged: 0 };
			sourceReads = 0;
			usedCodeGraph = false;
			readHinted = false;
			nudges.clear();
			project = findProject(ctx.cwd);
			index = undefined;
			lastError = undefined;
			state = project ? "checking" : "none";
			refresh();
			if (!project || !config.enabled) return;
			startIndexing();
		});

		pi.on("session_shutdown", async () => {
			closeAll();
		});

		for (const tool of TOOLS) {
			pi.registerTool({
				name: tool.name,
				label: tool.label,
				description: tool.description,
				promptSnippet: tool.snippet,
				parameters: tool.parameters,
				async execute(_id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: { cwd: string }) {
					const requested =
						typeof params.projectPath === "string" && params.projectPath.trim() ? resolve(ctx.cwd, params.projectPath) : undefined;
					const root = requested ? (findProject(requested)?.root ?? requested) : (project?.root ?? findProject(ctx.cwd)?.root);
					if (!root) throw new Error("No project: the working directory is not inside a git repo or an indexed directory. Pass projectPath.");
					if (root === project?.root && state === "indexing")
						throw new Error("CodeGraph is still building the index for this project; use rg/read for now and try again shortly.");
					const args: Record<string, unknown> = { ...params, projectPath: root };
					if (tool.name === "codegraph_files") {
						const path = normalizeFilesPath(params.path, root);
						if (path === undefined) delete args.path;
						else args.path = path;
					}
					usedCodeGraph = true;
					for (const w of lookupWords(params)) mem.lookedUp.add(w);
					const result = await server(root).call(tool.name, args, signal);
					const text = resultText(result);
					if (result.isError) throw new Error(text);
					return { content: [{ type: "text" as const, text }], details: { root } };
				},
			} as any);
		}

		pi.on("before_agent_start", async (event: any) => {
			if (!config.enabled) return;
			const guidelines: unknown = event?.systemPromptOptions?.promptGuidelines;
			if (!Array.isArray(guidelines)) return;
			// Static text, so the prompt cache survives turn to turn.
			for (const g of GUIDELINES) if (!guidelines.includes(g)) guidelines.push(g);
		});

		pi.on("tool_call", async (event: any) => {
			if (!config.enabled || config.mode === "off" || state !== "ready") return;
			const searches = searchesOf(event.toolName, event.input ?? {});
			if (searches.length === 0) return;
			const d = decide(config.mode, searches, `${event.toolName}\u0000${JSON.stringify(event.input)}`, mem);
			if (d.action === "block") {
				counts.blocked++;
				refresh();
				return { block: true, reason: d.reason };
			}
			if (d.action === "nudge") {
				counts.nudged++;
				nudges.set(event.toolCallId, d.hint);
			}
			return;
		});

		pi.on("tool_result", async (event: any) => {
			if (isCodeGraphTool(event.toolName)) return;
			let hint = nudges.get(event.toolCallId);
			nudges.delete(event.toolCallId);
			if (
				!hint &&
				config.enabled &&
				config.readHintAfter > 0 &&
				state === "ready" &&
				event.toolName === "read" &&
				!usedCodeGraph &&
				!readHinted &&
				typeof event.input?.path === "string" &&
				isSourceFile(event.input.path) &&
				++sourceReads >= config.readHintAfter
			) {
				readHinted = true;
				hint = READ_HINT;
			}
			if (!hint) return;
			return { content: [...(event.content ?? []), { type: "text", text: `\n${hint}` }] };
		});

	pi.registerCommand("codegraph", {
		description: "CodeGraph: status, on, off, mode, sync, reindex, init",
		getArgumentCompletions: (prefix: string) => completions(prefix),
		handler: async (args, ctx) => {
			const cmd = parseCommand(args);
			ui = ctx.ui;
			// The setting applies to this session either way; a failed save only means it is not remembered.
			const persist = async () => {
				try {
					await saveConfig(config);
				} catch (error) {
					ctx.ui.notify(`codegraph: could not save the setting (${(error as Error)?.message ?? String(error)}); it applies to this session only`, "warning");
				}
				refresh();
			};
			switch (cmd.kind) {
				case "status":
					ctx.ui.notify(statusReport(snapshot()), "info");
					return;
				case "on":
				case "off":
					config.enabled = cmd.kind === "on";
					if (config.enabled && project && state === "checking") startIndexing();
					await persist();
					ctx.ui.notify(`codegraph ${config.enabled ? "on" : "off"}`, "info");
					return;
				case "mode":
					config.mode = cmd.mode;
					await persist();
					ctx.ui.notify(`codegraph: mode ${cmd.mode}`, "info");
					return;
				case "sync":
				case "reindex":
				case "init": {
					if (!project && cmd.kind === "init" && resolve(ctx.cwd) !== homedir()) project = { root: resolve(ctx.cwd), hasIndexDir: false, isRepo: false };
					if (!project) {
						ctx.ui.notify("codegraph: no project here (not inside a git repo or an indexed directory)", "warning");
						return;
					}
					const action = cmd.kind === "reindex" ? "index" : cmd.kind;
					ctx.ui.notify(`codegraph: ${action} started for ${project.root}`, "info");
					await runAction(action);
					ctx.ui.notify(lastError ? `codegraph: ${lastError}` : statusReport(snapshot()), lastError ? "warning" : "info");
					return;
				}
				case "invalid":
					ctx.ui.notify(cmd.message, "warning");
					return;
			}
		},
	});
	};
}

export default createExtension();
