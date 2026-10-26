import {
	BID_MODEL_BYTES,
	BidNetwork,
	LOCAL_BIDDERS,
	type LocalBidder,
} from "./bid-network";
import type { BidPosition } from "./bid-position";

interface Request {
	readonly position: BidPosition;
	readonly policy: LocalBidder;
	readonly url: string;
}
interface WorkerScope {
	readonly location: Location;
	onmessage: ((event: MessageEvent<Request>) => void) | null;
	postMessage(message: unknown): void;
}

function start(scope: WorkerScope): void {
	let loaded: { policy: LocalBidder; network: Promise<BidNetwork> } | undefined;
	const load = async (request: Request): Promise<BidNetwork> => {
		const url = new URL(request.url);
		if (
			!LOCAL_BIDDERS.includes(request.policy) ||
			url.origin !== scope.location.origin ||
			url.search ||
			url.hash ||
			!url.pathname.endsWith(`/bot-models/brl-${request.policy}.f32`)
		)
			throw new Error("invalid bidding model location");
		const response = await fetch(url);
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
		return new BidNetwork(bytes.buffer, request.policy);
	};
	scope.onmessage = (event) => {
		if (loaded?.policy !== event.data.policy)
			loaded = { policy: event.data.policy, network: load(event.data) };
		void loaded.network
			.then((network) =>
				scope.postMessage({
					ok: true,
					analysis: network.choose(event.data.position),
				}),
			)
			.catch(() => scope.postMessage({ ok: false }));
	};
}

start(self as unknown as WorkerScope);
