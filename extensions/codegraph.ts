/**
 * pi-codegraph: CodeGraph-first code navigation for pi: persistent index, auto init/sync, and a gate that steers structural searches to codegraph_* tools.
 *
 * Pure logic lives in core/ and command/ (tested directly). This file only wires it to pi:
 * hooks, the /codegraph command and the status line. Settings persist in <agent dir>/codegraph.json.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { completions, parseCommand } from "./command/parse.ts";
import { type Config, DEFAULT_CONFIG, readConfig, saveConfig } from "./core/config.ts";
import { greet } from "./core/greet.ts";

export const statusText = (c: Config): string => `codegraph: ${c.enabled ? "on" : "off"} · level ${c.level}`;

export default function (pi: ExtensionAPI) {
	let config: Config = { ...DEFAULT_CONFIG };

	const showStatus = (ctx: { ui: { setStatus(key: string, text: string): void } }) =>
		ctx.ui.setStatus("codegraph", config.enabled && config.showStatus ? statusText(config) : "");

	pi.on("session_start", async (_event, ctx) => {
		const { config: loaded, problem } = await readConfig();
		config = loaded;
		if (problem) ctx.ui.notify(`codegraph: ${problem}; using the defaults`, "warning");
		showStatus(ctx);
	});

	pi.registerCommand("codegraph", {
		description: "CodeGraph: status, on, off, level, hello",
		getArgumentCompletions: (prefix: string) => completions(prefix),
		handler: async (args, ctx) => {
			const cmd = parseCommand(args);
			// The setting applies to this session either way; a failed save only means it is not remembered.
			const persist = async () => {
				try {
					await saveConfig(config);
				} catch (error) {
					ctx.ui.notify(`codegraph: could not save the setting (${(error as Error)?.message ?? String(error)}); it applies to this session only`, "warning");
				}
				showStatus(ctx);
			};
			switch (cmd.kind) {
				case "status":
					ctx.ui.notify(statusText(config), "info");
					return;
				case "on":
				case "off":
					config.enabled = cmd.kind === "on";
					await persist();
					ctx.ui.notify(`codegraph ${config.enabled ? "on" : "off"}`, "info");
					return;
				case "level":
					config.level = cmd.level;
					await persist();
					ctx.ui.notify(`codegraph: level ${cmd.level}`, "info");
					return;
				case "hello":
					ctx.ui.notify(greet(cmd.name), "info");
					return;
				case "invalid":
					ctx.ui.notify(cmd.message, "warning");
					return;
			}
		},
	});
}
