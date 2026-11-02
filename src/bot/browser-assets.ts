import {
	BID_MODEL_BYTES,
	LOCAL_BIDDERS,
	type LocalBidder,
} from "./bid-network";
import bidWorkerUrl from "./bid-worker.ts?worker&url";
import playWorkerUrl from "./play-worker.ts?worker&url";

/** Resources shared by the room's bot workers, retained until the room closes. */
export class BrowserBotAssets {
	readonly #abort = new AbortController();
	readonly #workers = new Map<string, Promise<string>>();
	readonly #models = new Map<LocalBidder, Promise<ArrayBuffer>>();
	readonly #objectUrls = new Set<string>();
	#disposed = false;

	preload(policy: LocalBidder): void {
		// A failed background load is retried when a worker actually needs the resource.
		void Promise.all([
			this.worker("bid"),
			this.worker("play"),
			this.model(policy),
		]).catch(() => {});
	}

	worker(kind: "bid" | "play"): Promise<string> {
		const url = kind === "bid" ? bidWorkerUrl : playWorkerUrl;
		// Vite's development workers import other development modules by URL.
		if (import.meta.env.DEV) return Promise.resolve(url);
		const existing = this.#workers.get(kind);
		if (existing) return existing;
		const pending = this.#loadWorker(url).catch((error: unknown) => {
			this.#workers.delete(kind);
			throw error;
		});
		this.#workers.set(kind, pending);
		return pending;
	}

	model(policy: LocalBidder): Promise<ArrayBuffer> {
		if (!LOCAL_BIDDERS.includes(policy))
			return Promise.reject(new Error("invalid bidding policy"));
		const existing = this.#models.get(policy);
		if (existing) return existing;
		const pending = this.#loadModel(policy).catch((error: unknown) => {
			this.#models.delete(policy);
			throw error;
		});
		this.#models.set(policy, pending);
		return pending;
	}

	dispose(): void {
		this.#disposed = true;
		this.#abort.abort();
		for (const url of this.#objectUrls) URL.revokeObjectURL(url);
		this.#objectUrls.clear();
		this.#workers.clear();
		this.#models.clear();
	}

	async #loadWorker(path: string): Promise<string> {
		const url = new URL(path, document.baseURI);
		if (url.origin !== location.origin)
			throw new Error("invalid bot worker location");
		const response = await fetch(url, {
			signal: this.#abort.signal,
			redirect: "error",
		});
		if (!response.ok) throw new Error("bot worker is unavailable");
		const source = await response.blob();
		if (this.#disposed) throw new Error("bot resources are disposed");
		const objectUrl = URL.createObjectURL(
			new Blob([source], { type: "text/javascript" }),
		);
		this.#objectUrls.add(objectUrl);
		return objectUrl;
	}

	async #loadModel(policy: LocalBidder): Promise<ArrayBuffer> {
		const url = new URL(`bot-models/brl-${policy}.f32`, document.baseURI);
		if (url.origin !== location.origin)
			throw new Error("invalid bidding model location");
		const response = await fetch(url, {
			signal: this.#abort.signal,
			redirect: "error",
		});
		if (!response.ok || !response.body)
			throw new Error("bidding weights are unavailable");
		const bytes = new Uint8Array(BID_MODEL_BYTES);
		const reader = response.body.getReader();
		let offset = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (offset + value.length > bytes.length) {
				await reader.cancel();
				throw new Error("oversized bidding model");
			}
			bytes.set(value, offset);
			offset += value.length;
		}
		if (offset !== bytes.length) throw new Error("incomplete bidding model");
		return bytes.buffer;
	}
}
