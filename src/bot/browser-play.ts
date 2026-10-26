import { isCard } from "../bridge/cards";
import { BotRequestAbortedError } from "./errors";
import type { PlayAnalysis } from "./play-engine";
import type { PlayPosition } from "./play-position";

export interface PlayChooser {
	choose(position: PlayPosition, signal: AbortSignal): Promise<PlayAnalysis>;
	stop(): void;
}

/** One bounded search at a time; terminating a worker also interrupts synchronous WASM. */
export class BrowserPlayEngine implements PlayChooser {
	#worker: Worker | undefined;
	#cancel: (() => void) | undefined;

	stop(): void {
		this.#cancel?.();
		this.#worker?.terminate();
		this.#worker = undefined;
	}

	choose(position: PlayPosition, signal: AbortSignal): Promise<PlayAnalysis> {
		if (signal.aborted) return Promise.reject(new BotRequestAbortedError());
		if (this.#cancel)
			return Promise.reject(new Error("card engine is already searching"));
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
				worker.terminate();
				this.#worker = undefined;
				reject(error);
			};
			const abort = () => fail(new BotRequestAbortedError());
			const accept = (analysis: PlayAnalysis, terminate: boolean) => {
				finish();
				if (terminate) {
					worker.terminate();
					this.#worker = undefined;
				}
				resolve(analysis);
			};
			const budgetTimer = setTimeout(() => {
				if (latest) accept(latest, true);
			}, 1500);
			const timer = setTimeout(
				() => fail(new Error("card engine exceeded its search deadline")),
				15_000,
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
				else if (performance.now() - started >= 1500) accept(latest, true);
			};
			worker.postMessage(position);
		});
	}
}
