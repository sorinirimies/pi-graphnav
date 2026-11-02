#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# README demos: a throw-away sample project and a real pi with only this plugin
# ──────────────────────────────────────────────────────────────────────────────
# Everything lives under /tmp/pi-graphnav-demo (HOME and the pi agent dir point there),
# so a recording never reads your sessions, settings, credentials or projects. The model
# is examples/vhs/mock-llm.ts: scripted tool calls that pi really runs, so the blocking,
# nudging and CodeGraph answers on screen are the plugin's own.
#
# Usage:
#   nu scripts/vhs.nu setup              # fresh sample project + agent dir
#   nu scripts/vhs.nu pi [--mode nudge]  # start the mock model and pi (used by the tapes)
#   nu scripts/vhs.nu record [name]      # render one tape, or all of them
# ──────────────────────────────────────────────────────────────────────────────

export const DEMO = "/tmp/pi-graphnav-demo"
export const PORT = 18990

# The sample project: a tiny HTTP API with a call chain worth navigating.
export const SAMPLE = {
    "src/config.ts": "export interface Config {
	port: number;
	routes: string[];
}

/** Turns raw JSON into a Config, rejecting anything malformed. */
export function parseConfig(raw: string): Config {
	const data = JSON.parse(raw) as Partial<Config>;
	if (typeof data.port !== \"number\") throw new Error(\"port must be a number\");
	return { port: data.port, routes: data.routes ?? [] };
}

export async function loadSettings(path = \"config.json\"): Promise<Config> {
	return parseConfig(await Bun.file(path).text());
}
"
    "src/routes.ts": "import type { Config } from \"./config\";

export type Handler = (req: Request) => Response;

export function registerRoutes(config: Config): Map<string, Handler> {
	const routes = new Map<string, Handler>();
	for (const path of config.routes) routes.set(path, () => new Response(`ok ${path}`));
	return routes;
}
"
    "src/server.ts": "import { loadSettings } from \"./config\";
import { registerRoutes } from \"./routes\";

export async function startServer(): Promise<void> {
	const config = await loadSettings();
	const routes = registerRoutes(config);
	Bun.serve({ port: config.port, fetch: (req) => routes.get(new URL(req.url).pathname)?.(req) ?? new Response(\"not found\", { status: 404 }) });
}
"
    "src/cli.ts": "import { loadSettings, parseConfig } from \"./config\";
import { startServer } from \"./server\";

export async function main(args: string[]): Promise<void> {
	if (args[0] === \"check\") {
		parseConfig(await Bun.file(args[1] ?? \"config.json\").text());
		return;
	}
	await loadSettings();
	await startServer();
}
"
    "config.json": "{ \"port\": 8080, \"routes\": [\"/health\", \"/users\"] }
"
    "README.md": "# acme-api

A tiny HTTP API.
"
}

# Environment for pi: everything redirected into the demo directory.
export def demo_env [demo: string]: nothing -> record {
    { HOME: ($demo | path join home), PI_CODING_AGENT_DIR: ($demo | path join agent), PI_OFFLINE: "1", TZ: UTC }
}

export def project_dir [demo: string]: nothing -> string { $demo | path join home projects acme-api }

# models.json: the scripted local model.
export def models_config [port: int]: nothing -> record {
    { providers: { demo: {
        baseUrl: $"http://127.0.0.1:($port)/v1", api: "openai-completions", apiKey: "demo",
        models: [{ id: "demo-model", name: "demo-model", contextWindow: 200000, maxTokens: 8192 }]
    } } }
}

export def settings_config []: nothing -> record {
    { defaultProvider: demo, defaultModel: demo-model, theme: dark, defaultThinkingLevel: off,
      lastChangelogVersion: "9.9.9", quietStartup: header }
}

# The plugin's own settings for a recording.
export def plugin_config [mode: string]: nothing -> record {
    { enabled: true, showStatus: true, mode: $mode, autoInit: true, autoSync: true, watch: true, readHintAfter: 3, timeoutMs: 30000 }
}

# pi with only this plugin: no other extensions, skills, context files, MCP or session log.
export def pi_args [extension: string]: nothing -> list<string> {
    [--no-extensions -e $extension --no-skills --no-prompt-templates --no-context-files --no-mcp --no-session --offline]
}

# Tapes to render: one by name, or every tape.
export def tapes [dir: string, name?: string]: nothing -> list<string> {
    if $name != null { return [($dir | path join $"($name).tape")] }
    glob ($dir | path join "*.tape") | sort
}

def write_json [path: string, value: record] {
    mkdir ($path | path dirname)
    $value | to json --indent 2 | save --force $path
}

def "main setup" [] {
    rm -rf $DEMO
    let project = (project_dir $DEMO)
    for file in ($SAMPLE | transpose path text) {
        let path = ($project | path join $file.path)
        mkdir ($path | path dirname)
        $file.text | save --force $path
    }
    let agent = ($DEMO | path join agent)
    write_json ($agent | path join models.json) (models_config $PORT)
    write_json ($agent | path join settings.json) (settings_config)
    write_json ($agent | path join codegraph.json) (plugin_config enforce)
    cd $project
    ^git init -q
    ^git -c user.name=demo -c user.email=demo@example.com add -A
    ^git -c user.name=demo -c user.email=demo@example.com commit -qm "acme-api"
    print -e $"demo ready: ($project)"
}

def "main pi" [--mode: string = "enforce"] {
    let repo = ($env.FILE_PWD | path dirname)
    let agent = ($DEMO | path join agent)
    write_json ($agent | path join codegraph.json) (plugin_config $mode)
    job spawn { ^bun ($repo | path join examples vhs mock-llm.ts) $PORT out+err> /dev/null }
    sleep 300ms
    cd (project_dir $DEMO)
    with-env (demo_env $DEMO) { ^pi ...(pi_args ($repo | path join extensions graphnav.ts)) }
}

def "main record" [name?: string] {
    for tape in (tapes examples/vhs $name) {
        print -e $"▶ ($tape)"
        ^vhs $tape
    }
}

def main [] { print -e "usage: nu scripts/vhs.nu (setup | pi [--mode enforce|nudge] | record [name])" }
