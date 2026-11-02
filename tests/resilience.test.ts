import { describe, expect, test } from "bun:test";
import { ServerExitError } from "../extensions/core/mcp.ts";
import { countsAsFailure, Guard, isCrash, UNAVAILABLE } from "../extensions/core/resilience.ts";

const boom = (msg = "boom") => async (): Promise<string> => {
	throw new Error(msg);
};

describe("isCrash and countsAsFailure", () => {
	test("only a dead server process is a crash", () => {
		expect(isCrash(new ServerExitError("codegraph serve exited with code 1"))).toBe(true);
		expect(isCrash(new Error("write EPIPE"))).toBe(true);
		expect(isCrash(new Error("read ECONNRESET"))).toBe(true);
		expect(isCrash(new Error("CodeGraph did not answer within 30s"))).toBe(false);
		expect(isCrash(new Error("spawn codegraph ENOENT"))).toBe(false);
		expect(isCrash("EPIPE")).toBe(false);
	});

	test("an abort is not CodeGraph's failure; everything else is", () => {
		expect(countsAsFailure(new Error("Aborted"))).toBe(false);
		expect(countsAsFailure(new Error("Aborted early"))).toBe(true);
		expect(countsAsFailure(new Error("timeout"))).toBe(true);
		expect(countsAsFailure("weird")).toBe(true);
	});
});

describe("Guard", () => {
	test("passes results through", async () => {
		const g = await Guard.create({ threshold: 2, resetMs: 1000 });
		expect(await g.run(async () => 42)).toBe(42);
		expect(g.open).toBe(false);
	});

	test("a crash is retried once with a fresh attempt", async () => {
		const g = await Guard.create({ threshold: 2, resetMs: 1000 });
		let n = 0;
		expect(
			await g.run(async () => {
				if (n++ === 0) throw new ServerExitError("codegraph serve exited with code 1");
				return "second try";
			}),
		).toBe("second try");
		expect(n).toBe(2);
	});

	test("other failures are not retried", async () => {
		const g = await Guard.create({ threshold: 5, resetMs: 1000 });
		let n = 0;
		await expect(
			g.run(async () => {
				n++;
				throw new Error("timeout");
			}),
		).rejects.toThrow("timeout");
		expect(n).toBe(1);
	});

	test("after `threshold` failures in a row it opens, fails fast, and reports the change", async () => {
		const changes: boolean[] = [];
		const g = await Guard.create({ threshold: 2, resetMs: 60_000, onChange: (a) => changes.push(a) });
		await expect(g.run(boom())).rejects.toThrow("boom");
		expect(g.open).toBe(false);
		await expect(g.run(boom())).rejects.toThrow("boom");
		expect(g.open).toBe(true);
		expect(changes).toEqual([false]);
		let ran = false;
		await expect(
			g.run(async () => {
				ran = true;
				return 1;
			}),
		).rejects.toThrow(UNAVAILABLE);
		expect(ran).toBe(false);
	});

	test("aborts do not count, and keep their own error", async () => {
		const g = await Guard.create({ threshold: 1, resetMs: 60_000 });
		await expect(g.run(boom("Aborted"))).rejects.toThrow("Aborted");
		await expect(g.run(boom("Aborted"))).rejects.toThrow("Aborted");
		expect(g.open).toBe(false);
		expect(await g.run(async () => "fine")).toBe("fine");
	});

	test("after resetMs a trial call closes it again, and the change is reported", async () => {
		const changes: boolean[] = [];
		const g = await Guard.create({ threshold: 1, resetMs: 30, onChange: (a) => changes.push(a) });
		await expect(g.run(boom())).rejects.toThrow("boom");
		expect(g.open).toBe(true);
		await Bun.sleep(45);
		expect(g.open).toBe(false);
		expect(changes).toEqual([false, true]); // the timer, with nothing calling
		expect(await g.run(async () => "recovered")).toBe("recovered");
		expect(changes).toEqual([false, true, true]); // closed by the trial call
	});

	test("`now` drives the open window", async () => {
		let t = 0;
		const g = await Guard.create({ threshold: 1, resetMs: 100, now: () => t });
		await expect(g.run(boom())).rejects.toThrow("boom");
		expect(g.open).toBe(true);
		t = 99;
		expect(g.open).toBe(true);
		t = 100;
		expect(g.open).toBe(false);
	});
});
