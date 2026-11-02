/**
 * Resilience around the CodeGraph server, built on arrow-resilience-kit:
 *
 * - a circuit breaker per project: after `threshold` failed calls in a row CodeGraph counts
 *   as unavailable for `resetMs`; calls then fail fast, and the gate stops sending the agent
 *   to a tool that does not answer;
 * - one retry when the server process died under a call (a crash, not a slow query): the
 *   retry starts a fresh process.
 *
 * Aborts and CodeGraph's own "no such symbol" answers are not failures.
 */
import { CircuitBreaker, Retry } from "arrow-resilience-kit";
import { ServerExitError } from "./mcp.ts";

export const UNAVAILABLE =
	"CodeGraph is unavailable for this project right now (its last calls failed); use rg/read meanwhile. It is retried automatically.";

/** The server process went away under the call: worth one retry with a fresh process. */
export const isCrash = (e: unknown): boolean => e instanceof ServerExitError || (e instanceof Error && /\bEPIPE\b|\bECONNRESET\b/.test(e.message));

/** Failures that count against CodeGraph's health. An abort is the user's doing, not CodeGraph's. */
export const countsAsFailure = (e: unknown): boolean => !(e instanceof Error && /^Aborted$/.test(e.message));

const isOpenError = (e: unknown): boolean =>
	(e as { constructor?: { name?: string } })?.constructor?.name === "CircuitBreakerOpenException" || /circuit breaker is open/i.test(String((e as Error)?.message));

export interface GuardOptions {
	/** Failed calls in a row before CodeGraph counts as unavailable. */
	threshold: number;
	/** How long it then stays unavailable before a trial call. */
	resetMs: number;
	/** Called when availability changes (to refresh the status line). */
	onChange?: (available: boolean) => void;
	now?: () => number;
}

export class Guard {
	private openedAt: number | undefined;

	private constructor(
		private readonly breaker: CircuitBreaker,
		private readonly opts: GuardOptions,
	) {
		breaker.onStateChange((from, to) => {
			if (to === "Open") {
				this.openedAt = this.clock();
				opts.onChange?.(false);
				// Tell the status line when the pause is over, even if nothing calls CodeGraph meanwhile.
				const t = setTimeout(() => opts.onChange?.(!this.open), opts.resetMs);
				(t as { unref?: () => void }).unref?.();
			} else if (to === "Closed" && from !== "Closed") {
				this.openedAt = undefined;
				opts.onChange?.(true);
			}
		});
	}

	static async create(opts: GuardOptions): Promise<Guard> {
		return new Guard(await CircuitBreaker.create(opts.threshold, opts.resetMs, 1, 1), opts);
	}

	private clock(): number {
		return (this.opts.now ?? Date.now)();
	}

	/** CodeGraph counts as unavailable: its calls failed `threshold` times in a row, and `resetMs` has not passed. */
	get open(): boolean {
		return this.openedAt !== undefined && this.clock() - this.openedAt < this.opts.resetMs;
	}

	/** Run a call: retried once after a crash, counted by the breaker, failing fast while unavailable. */
	async run<T>(block: () => Promise<T>): Promise<T> {
		let excused: { error: unknown } | undefined;
		try {
			return await this.breaker.execute(async () => {
				try {
					return await Retry.withBackoff(block, { retries: 1, baseMillis: 0, shouldRetry: isCrash });
				} catch (e) {
					if (countsAsFailure(e)) throw e;
					excused = { error: e };
					return undefined as T;
				}
			});
		} catch (e) {
			if (isOpenError(e)) throw new Error(UNAVAILABLE);
			throw e;
		} finally {
			if (excused) throw excused.error;
		}
	}
}
