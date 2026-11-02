import { describe, expect, test } from "bun:test";
import { greet } from "../extensions/core/greet.ts";

describe("greet", () => {
	test("greets by name", () => {
		expect(greet("pi")).toBe("Hello, pi!");
	});

	test("trims the name", () => {
		expect(greet("  pi  ")).toBe("Hello, pi!");
	});

	test("greets nobody politely", () => {
		expect(greet("   ")).toBe("Hello!");
	});
});
