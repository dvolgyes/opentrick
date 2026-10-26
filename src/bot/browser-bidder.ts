import { isCall } from "../bridge/rules";
import type { BidAnalysis, LocalBidder } from "./bid-network";
import type { BidPosition } from "./bid-position";
import { BotRequestAbortedError } from "./errors";

export interface BidChooser {
	choose(
		position: BidPosition,
		policy: LocalBidder,
		signal: AbortSignal,
	): Promise<BidAnalysis>;
	stop(): void;
}

export class BrowserBidder implements BidChooser {
	#worker: Worker | undefined;
	#abort: (() => void) | undefined;
	stop(): void {
		this.#abort?.();
		this.#worker?.terminate();
		this.#worker = undefined;
	}
	choose(
		position: BidPosition,
		policy: LocalBidder,
		signal: AbortSignal,
	): Promise<BidAnalysis> {
		if (signal.aborted) return Promise.reject(new BotRequestAbortedError());
		if (this.#abort)
			return Promise.reject(new Error("local bidder is already choosing"));
		this.#worker ??= new Worker(new URL("./bid-worker.ts", import.meta.url), {
			type: "module",
		});
		const worker = this.#worker;
		const url = new URL(`bot-models/brl-${policy}.f32`, document.baseURI).href;
		return new Promise((resolve, reject) => {
			const clean = () => {
				clearTimeout(timer);
				signal.removeEventListener("abort", abort);
				worker.onmessage = null;
				worker.onerror = null;
				this.#abort = undefined;
			};
			const fail = (error: Error) => {
				clean();
				worker.terminate();
				this.#worker = undefined;
				reject(error);
			};
			const abort = () => fail(new BotRequestAbortedError());
			const timer = setTimeout(
				() => fail(new Error("local bidder exceeded its deadline")),
				60_000,
			);
			this.#abort = abort;
			signal.addEventListener("abort", abort, { once: true });
			worker.onerror = () =>
				fail(new Error("local bidder worker could not run"));
			worker.onmessage = (event: MessageEvent) => {
				if (
					!event.data?.ok ||
					!isCall(event.data.analysis?.call) ||
					!position.legal.includes(event.data.analysis.call)
				) {
					fail(new Error("local bidder returned no legal call"));
					return;
				}
				clean();
				resolve(event.data.analysis as BidAnalysis);
			};
			worker.postMessage({ position, policy, url });
		});
	}
}
