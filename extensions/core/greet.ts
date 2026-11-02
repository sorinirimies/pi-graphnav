/** The sample feature: a greeting. Replace it with the real logic; keep it pure. */
export function greet(name: string): string {
	const trimmed = name.trim();
	return trimmed ? `Hello, ${trimmed}!` : "Hello!";
}
