import { isCall } from "../bridge/rules";
import type { BidAnalysis, LocalBidder } from "./bid-network";
import type { BidPosition } from "./bid-position";
import type { BrowserBotAssets } from "./browser-assets";
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
	#workerPolicy: LocalBidder | undefined;
	readonly #assets: BrowserBotAssets | undefined;
	constructor(assets?: BrowserBotAssets) {
		this.#assets = assets;
	}
	stop(): void {
		this.#abort?.();
		this.#worker?.terminate();
		this.#worker = undefined;
		this.#workerPolicy = undefined;
	}
	choose(
		position: BidPosition,
		policy: LocalBidder,
		signal: AbortSignal,
	): Promise<BidAnalysis> {
		if (signal.aborted) return Promise.reject(new BotRequestAbortedError());
		if (this.#abort)
			return Promise.reject(new Error("local bidder is already choosing"));
		const url = new URL(`bot-models/brl-${policy}.f32`, document.baseURI).href;
		return new Promise((resolve, reject) => {
			let worker: Worker | undefined;
			let finished = false;
			const clean = () => {
				finished = true;
				clearTimeout(timer);
				signal.removeEventListener("abort", abort);
				if (worker) {
					worker.onmessage = null;
					worker.onerror = null;
				}
				this.#abort = undefined;
			};
			const fail = (error: Error) => {
				clean();
				(worker ?? this.#worker)?.terminate();
				this.#worker = undefined;
				this.#workerPolicy = undefined;
				reject(error);
			};
			const abort = () => fail(new BotRequestAbortedError());
			const timer = setTimeout(
				() => fail(new Error("local bidder exceeded its deadline")),
				60_000,
			);
			this.#abort = abort;
			signal.addEventListener("abort", abort, { once: true });
			const start = (workerUrl?: string, bytes?: ArrayBuffer) => {
				if (finished) return;
				try {
					this.#worker ??= new Worker(
						workerUrl ?? new URL("./bid-worker.ts", import.meta.url),
						{ type: "module" },
					);
					worker = this.#worker;
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
						this.#workerPolicy = policy;
						clean();
						resolve(event.data.analysis as BidAnalysis);
					};
					worker.postMessage({
						position,
						policy,
						url,
						...(bytes ? { bytes } : {}),
					});
				} catch {
					fail(new Error("local bidder worker could not run"));
				}
			};
			if (!this.#assets) start();
			else if (this.#worker && this.#workerPolicy === policy) start();
			else
				void Promise.all([
					this.#assets.worker("bid"),
					this.#assets.model(policy),
				]).then(
					([workerUrl, bytes]) => start(workerUrl, bytes),
					() => {
						if (!finished)
							fail(new Error("local bidder resources are unavailable"));
					},
				);
		});
	}
}
