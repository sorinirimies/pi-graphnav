/**
 * A scripted OpenAI-compatible chat endpoint for the demos: no network, no API key, no real
 * model. Each demo question maps to a fixed list of steps (tool calls, then an answer); the
 * step to play is the number of assistant turns since the question. The tool calls are real:
 * pi runs them, and pi-graphnav blocks, nudges or answers them as it would for any model.
 *
 *   bun examples/vhs/mock-llm.ts [port]      (default 18990)
 */
const port = Number(process.argv[2] ?? 18990);

type Step = { tool: string; args: Record<string, unknown> } | { text: string };

const SCRIPTS: { match: RegExp; steps: Step[] }[] = [
	{
		match: /parseConfig/,
		steps: [
			{ tool: "bash", args: { command: "rg -n parseConfig src" } },
			{ tool: "codegraph_search", args: { query: "parseConfig" } },
			{ tool: "codegraph_callers", args: { symbol: "parseConfig" } },
			{
				text:
					"`parseConfig` is defined in `src/config.ts` and turns raw JSON into a `Config`.\n" +
					"Callers: `loadSettings` (src/config.ts:13) and `main` (src/cli.ts:4); `startServer` reaches it through `loadSettings`.\n" +
					"Found with codegraph_search and codegraph_callers: the rg search was blocked and pointed me there.",
			},
		],
	},
	{
		match: /settings/i,
		steps: [
			{ tool: "bash", args: { command: "rg -n loadSettings src" } },
			{ tool: "codegraph_explore", args: { query: "loadSettings startServer" } },
			{
				text:
					"`startServer` calls `loadSettings`, which reads `config.json` and validates it with `parseConfig`;\n" +
					"the resulting `Config` sets the port and the routes `registerRoutes` mounts.\n" +
					"The rg search ran (nudge mode) and its hint sent me to codegraph_explore for the full picture.",
			},
		],
	},
	{
		match: /what does/i,
		steps: [
			{ tool: "codegraph_explore", args: { query: "startServer registerRoutes" } },
			{ text: "An HTTP API: `main` parses the CLI flags, `startServer` loads the settings and `registerRoutes` mounts the handlers." },
		],
	},
];

type Message = { role: string; content?: unknown };
const textOf = (c: unknown): string =>
	typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p && typeof p === "object" && "text" in p ? String(p.text) : "")).join("") : "";

function nextStep(messages: Message[]): Step {
	const last = messages.map((m) => m.role).lastIndexOf("user");
	const question = textOf(messages[last]?.content);
	const steps = SCRIPTS.find((s) => s.match.test(question))?.steps ?? [{ text: "This demo model only knows the scripted questions." }];
	const turn = messages.slice(last + 1).filter((m) => m.role === "assistant").length;
	return steps[Math.min(turn, steps.length - 1)]!;
}

const USAGE = { prompt_tokens: 4_100, completion_tokens: 120, total_tokens: 4_220 };
const chunk = (delta: object, finish: string | null = null, usage?: object) =>
	`data: ${JSON.stringify({ id: "demo", object: "chat.completion.chunk", created: 0, model: "demo-model", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Long enough to read the previous tool result in the recording. */
const PAUSE_MS = 2_500;

// Exit with the shell that started us (a recording ends by killing the terminal).
const parent = process.ppid;
setInterval(() => process.ppid !== parent && process.exit(0), 500);

let calls = 0;
Bun.serve({
	port,
	hostname: "127.0.0.1",
	async fetch(req) {
		const url = new URL(req.url);
		if (req.method === "GET" && url.pathname.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "demo-model", object: "model" }] });
		if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 });
		const body = (await req.json().catch(() => ({}))) as { messages?: Message[] };
		const step = nextStep(body.messages ?? []);
		const enc = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				const send = (s: string) => controller.enqueue(enc.encode(s));
				await sleep(PAUSE_MS);
				if ("tool" in step) {
					const id = `call_${++calls}`;
					send(chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name: step.tool, arguments: "" } }] }));
					send(chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(step.args) } }] }));
					send(chunk({}, "tool_calls", USAGE));
				} else {
					send(chunk({ role: "assistant", content: "" }));
					for (const word of step.text.split(" ")) {
						send(chunk({ content: `${word} ` }));
						await sleep(30);
					}
					send(chunk({}, "stop", USAGE));
				}
				send("data: [DONE]\n\n");
				controller.close();
			},
		});
		return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
	},
});
console.error(`mock-llm listening on http://127.0.0.1:${port}`);
