import { isCard } from "../bridge/cards";
import { BotRequestAbortedError } from "./errors";
import { playTimeMs } from "./play-budget";
import type { PlayAnalysis } from "./play-engine";
import type { PlayPosition } from "./play-position";

export interface PlayChooser {
	choose(
		position: PlayPosition,
		signal: AbortSignal,
		timeMs?: number,
	): Promise<PlayAnalysis>;
	stop(): void;
}

/** One bounded search at a time; terminating a worker also interrupts synchronous WASM. */
export class BrowserPlayEngine implements PlayChooser {
	#worker: Worker | undefined;
	#cancel: (() => void) | undefined;
	#drainTimer: ReturnType<typeof setTimeout> | undefined;
	readonly #timeMs: number;
	constructor(options: { readonly timeMs?: number } = {}) {
		this.#timeMs = playTimeMs(options.timeMs);
	}

	stop(): void {
		this.#cancel?.();
		this.#discardWorker();
	}

	#discardWorker(): void {
		clearTimeout(this.#drainTimer);
		this.#drainTimer = undefined;
		this.#worker?.terminate();
		this.#worker = undefined;
	}

	/** Let a completed-budget search finish so its initialized worker can be reused. */
	#drain(worker: Worker, position: PlayPosition): void {
		this.#drainTimer = setTimeout(() => this.#discardWorker(), 1000);
		worker.onerror = () => this.#discardWorker();
		worker.onmessage = (event: MessageEvent) => {
			const data = event.data;
			if (
				!data?.ok ||
				!isCard(data.analysis?.card) ||
				!position.legal.includes(data.analysis.card)
			) {
				this.#discardWorker();
				return;
			}
			if (data.partial) return;
			clearTimeout(this.#drainTimer);
			this.#drainTimer = undefined;
			worker.onmessage = null;
			worker.onerror = null;
		};
	}

	choose(
		position: PlayPosition,
		signal: AbortSignal,
		timeMs = this.#timeMs,
	): Promise<PlayAnalysis> {
		const budget = playTimeMs(timeMs);
		if (signal.aborted) return Promise.reject(new BotRequestAbortedError());
		if (this.#cancel)
			return Promise.reject(new Error("card engine is already searching"));
		// A worker still in native code cannot process another request promptly.
		if (this.#drainTimer !== undefined) this.#discardWorker();
		this.#worker ??= new Worker(new URL("./play-worker.ts", import.meta.url), {
			type: "module",
		});
		const worker = this.#worker;
		return new Promise((resolve, reject) => {
			const started = performance.now();
			let latest: PlayAnalysis | undefined;
			const finish = () => {
				clearTimeout(timer);
				clearTimeout(budgetTimer);
				signal.removeEventListener("abort", abort);
				worker.onmessage = null;
				worker.onerror = null;
				this.#cancel = undefined;
			};
			const fail = (error: Error) => {
				finish();
				this.#discardWorker();
				reject(error);
			};
			const abort = () => fail(new BotRequestAbortedError());
			const accept = (analysis: PlayAnalysis, draining: boolean) => {
				finish();
				if (draining) this.#drain(worker, position);
				resolve(analysis);
			};
			const budgetTimer = setTimeout(() => {
				if (latest) accept(latest, true);
			}, budget);
			const timer = setTimeout(
				() => fail(new Error("card engine exceeded its search deadline")),
				Math.max(15_000, budget + 10_000),
			);
			this.#cancel = abort;
			signal.addEventListener("abort", abort, { once: true });
			worker.onerror = () =>
				fail(new Error("card engine worker could not run"));
			worker.onmessage = (event: MessageEvent) => {
				const data = event.data;
				if (
					!data?.ok ||
					!isCard(data.analysis?.card) ||
					!position.legal.includes(data.analysis.card)
				) {
					fail(new Error("card engine returned no valid legal play"));
					return;
				}
				latest = data.analysis as PlayAnalysis;
				if (!data.partial) accept(latest, false);
				else if (performance.now() - started >= budget) accept(latest, true);
			};
			worker.postMessage({ position, timeMs: budget });
		});
	}
}
