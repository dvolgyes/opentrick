import { CALLS, type Call } from "../bridge/rules";
import { LOCAL_BIDDERS, type LocalBidder } from "../protocol";
import { type BidPosition, encodeBidPosition } from "./bid-position";

export { LOCAL_BIDDERS, type LocalBidder } from "../protocol";
export const BID_MODEL_BYTES = 14_725_276;

export interface BidAnalysis {
	readonly call: Call;
	readonly policy: LocalBidder;
	readonly candidates: readonly {
		readonly call: Call;
		readonly probability: number;
		readonly logit: number;
	}[];
}

/** BRL's published DeepMind architecture: four 1024-wide ReLU layers and a 38-action policy head. */
export class BidNetwork {
	readonly #weights: Float32Array;
	readonly #policy: LocalBidder;

	constructor(buffer: ArrayBuffer, policy: LocalBidder) {
		if (
			buffer.byteLength !== BID_MODEL_BYTES ||
			!LOCAL_BIDDERS.includes(policy)
		)
			throw new Error("invalid local bidding model format");
		const source = new DataView(buffer);
		const weights = new Float32Array(buffer.byteLength / 4);
		for (let i = 0; i < weights.length; i++) {
			const value = source.getFloat32(i * 4, true);
			if (!Number.isFinite(value))
				throw new Error("local bidding model contains a non-finite weight");
			weights[i] = value;
		}
		this.#weights = weights;
		this.#policy = policy;
	}

	logits(observation: Float32Array): Float32Array {
		if (
			observation.length !== 480 ||
			observation.some((value) => value !== 0 && value !== 1)
		)
			throw new Error("bid observation must contain 480 binary features");
		let input = observation;
		let offset = 0;
		for (const width of [1024, 1024, 1024, 1024, 38]) {
			const biasOffset = offset + input.length * width;
			const sums = new Float64Array(width);
			for (let j = 0; j < width; j++)
				sums[j] = this.#weights[biasOffset + j] ?? 0;
			for (let i = 0; i < input.length; i++) {
				const value = input[i] ?? 0;
				if (value === 0) continue;
				const row = offset + i * width;
				for (let j = 0; j < width; j++)
					sums[j] = (sums[j] ?? 0) + value * (this.#weights[row + j] ?? 0);
			}
			input = Float32Array.from(sums, (value) =>
				width === 38 ? value : Math.max(0, value),
			);
			offset = biasOffset + width;
		}
		if (input.some((value) => !Number.isFinite(value)))
			throw new Error("bidding inference produced invalid logits");
		return input;
	}

	choose(position: BidPosition): BidAnalysis {
		if (
			position.legal.length === 0 ||
			position.legal.some((call) => !CALLS.includes(call))
		)
			throw new Error("local bidder requires an authoritative legal-call list");
		const logits = this.logits(encodeBidPosition(position));
		const scored = position.legal.map((call) => ({
			call,
			logit: logits[CALLS.indexOf(call)] ?? Number.NEGATIVE_INFINITY,
		}));
		const max = Math.max(...scored.map((candidate) => candidate.logit));
		const denominator = scored.reduce(
			(sum, candidate) => sum + Math.exp(candidate.logit - max),
			0,
		);
		const candidates = scored
			.map((candidate) => ({
				...candidate,
				probability: Math.exp(candidate.logit - max) / denominator,
			}))
			.sort(
				(a, b) =>
					b.logit - a.logit || CALLS.indexOf(a.call) - CALLS.indexOf(b.call),
			);
		const selected = candidates[0];
		if (!selected) throw new Error("local bidder produced no legal call");
		return { call: selected.call, policy: this.#policy, candidates };
	}
}
