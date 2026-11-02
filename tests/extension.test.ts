import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { configPath, DEFAULT_CONFIG } from "../extensions/core/config.ts";
import { fakeCtx, load } from "./helpers.ts";

describe("extension", () => {
	test("registers the session hook and the command", () => {
		const { hooks, commands } = load();
		expect(Object.keys(hooks)).toEqual(["session_start"]);
		expect(Object.keys(commands)).toEqual(["codegraph"]);
	});

	test("the command completes its arguments", () => {
		expect(load().commands.codegraph!.getArgumentCompletions("of")!.map((c) => c.value)).toEqual(["off"]);
	});

	test("status, hello and invalid arguments notify", async () => {
		const { commands } = load();
		const ctx = fakeCtx();
		await commands.codegraph!.handler("", ctx);
		await commands.codegraph!.handler("hello pi", ctx);
		await commands.codegraph!.handler("bogus", ctx);
		expect(ctx.notes[0]).toEqual([`codegraph: on · level ${DEFAULT_CONFIG.level}`, "info"]);
		expect(ctx.notes[1]).toEqual(["Hello, pi!", "info"]);
		expect(ctx.notes[2]![1]).toBe("warning");
	});

	test("on, off and level change the setting, save it and update the status line", async () => {
		rmSync(configPath(), { force: true });
		const { hooks, commands } = load();
		const ctx = fakeCtx();
		await hooks.session_start!({}, ctx);
		expect(ctx.status.codegraph).toBe("codegraph: on · level 10");

		await commands.codegraph!.handler("level 42", ctx);
		expect(ctx.status.codegraph).toBe("codegraph: on · level 42");
		expect(JSON.parse(readFileSync(configPath(), "utf8")).level).toBe(42);

		await commands.codegraph!.handler("off", ctx);
		expect(ctx.status.codegraph).toBe("");
		expect(JSON.parse(readFileSync(configPath(), "utf8")).enabled).toBe(false);
		await commands.codegraph!.handler("on", ctx);
		expect(ctx.status.codegraph).toBe("codegraph: on · level 42");
	});

	test("session_start loads the saved settings and reports a broken file", async () => {
		const { hooks, commands } = load();
		const ctx = fakeCtx();
		await commands.codegraph!.handler("level 7", ctx);
		const fresh = fakeCtx();
		await load().hooks.session_start!({}, fresh);
		expect(fresh.status.codegraph).toBe("codegraph: on · level 7");

		await Bun.write(configPath(), "{ nope");
		const broken = fakeCtx();
		await hooks.session_start!({}, broken);
		expect(broken.notes[0]![0]).toContain("is not valid JSON");
		expect(existsSync(configPath())).toBe(true);
		rmSync(configPath(), { force: true });
	});

	test("a save that fails is reported and the setting still applies", async () => {
		const { commands } = load();
		const ctx = fakeCtx();
		const dir = process.env.PI_CODING_AGENT_DIR!;
		rmSync(dir, { recursive: true, force: true });
		await Bun.write(dir, "a file where the directory should be");
		await commands.codegraph!.handler("level 3", ctx);
		expect(ctx.notes[0]![0]).toContain("could not save the setting");
		expect(ctx.status.codegraph).toBe("codegraph: on · level 3");
		rmSync(dir, { force: true });
	});
});
