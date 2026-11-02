import { describe, expect, test } from "bun:test";
import { GUIDELINES, isCodeGraphTool, MAX_RESULT_CHARS, normalizeFilesPath, resultText, TOOL_NAMES, TOOLS } from "../extensions/core/tools.ts";

describe("TOOLS", () => {
	test("eight codegraph_* tools, each fully described", () => {
		expect(TOOL_NAMES).toEqual([
			"codegraph_explore",
			"codegraph_search",
			"codegraph_node",
			"codegraph_callers",
			"codegraph_callees",
			"codegraph_impact",
			"codegraph_files",
			"codegraph_status",
		]);
		for (const t of TOOLS) {
			expect(t.label.length).toBeGreaterThan(0);
			expect(t.description.length).toBeGreaterThan(0);
			expect(t.snippet.length).toBeGreaterThan(0);
			expect((t.parameters as any).properties.projectPath).toBeDefined();
		}
	});

	test("isCodeGraphTool", () => {
		expect(isCodeGraphTool("codegraph_search")).toBe(true);
		expect(isCodeGraphTool("codegraph_nope")).toBe(false);
		expect(isCodeGraphTool("bash")).toBe(false);
	});

	test("guidelines mention the tools", () => {
		expect(GUIDELINES.join(" ")).toContain("codegraph_explore");
	});
});

describe("resultText", () => {
	test("joins the text parts, skips the rest", () => {
		expect(
			resultText({
				content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }, { type: "text" }, null as any],
			}),
		).toBe("a\nb");
	});

	test("nothing gives a placeholder", () => {
		expect(resultText(undefined)).toBe("(no result)");
		expect(resultText({})).toBe("(no result)");
		expect(resultText({ content: [{ type: "text", text: "" }] })).toBe("(no result)");
	});

	test("a huge result is cut with a note", () => {
		const out = resultText({ content: [{ type: "text", text: "x".repeat(MAX_RESULT_CHARS + 10) }] });
		expect(out.startsWith("x".repeat(MAX_RESULT_CHARS))).toBe(true);
		expect(out).toContain(`[cut at ${MAX_RESULT_CHARS} characters`);
	});
});

describe("normalizeFilesPath", () => {
	test("absent or empty gives undefined", () => {
		for (const p of [undefined, 5, "", "  "]) expect(normalizeFilesPath(p, "/r")).toBeUndefined();
	});

	test("the root itself means everything", () => {
		expect(normalizeFilesPath("/r", "/r")).toBeUndefined();
		expect(normalizeFilesPath("/r", "/r/")).toBeUndefined();
		expect(normalizeFilesPath("./", "/r")).toBeUndefined();
	});

	test("absolute paths inside the root become relative, POSIX, no ./ or trailing /", () => {
		expect(normalizeFilesPath("/r/src/core/", "/r")).toBe("src/core");
		expect(normalizeFilesPath("C:\\r\\src\\a", "C:\\r")).toBe("src/a");
		expect(normalizeFilesPath("./src", "/r")).toBe("src");
		expect(normalizeFilesPath(" src ", "/r")).toBe("src");
		expect(normalizeFilesPath("/r//src", "/r")).toBe("src");
		expect(normalizeFilesPath("/r/.//src", "/r")).toBe("src");
		expect(normalizeFilesPath(".//src", "/r")).toBe("src");
		expect(normalizeFilesPath("/r/\\src", "/r")).toBe("src");
		expect(normalizeFilesPath("/other/x", "/r")).toBe("/other/x");
	});
});
