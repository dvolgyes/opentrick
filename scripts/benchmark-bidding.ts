import { readFile } from "node:fs/promises";
import { BidNetwork, type LocalBidder } from "../src/bot/bid-network";
import { bidPosition } from "../src/bot/bid-position";
import { DdsSolver } from "../src/bot/dds-solver";
import { dealCards } from "../src/bridge/deal";
import {
	applyAction,
	type Board,
	boardStatus,
	createBoard,
} from "../src/bridge/engine";
import { scoreContract } from "../src/bridge/rules";

// Frozen protocol: 16 deals, dealer/vulnerability cycle, two table orientations per deal.
// This measures bidding with double-dummy scoring, separately from card-play strength.
const policies: readonly LocalBidder[] = ["sl", "rl-fsp"];
const networks = new Map<LocalBidder, BidNetwork>();
for (const policy of policies) {
	const bytes = await readFile(`public/bot-models/brl-${policy}.f32`);
	networks.set(
		policy,
		new BidNetwork(
			bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
			policy,
		),
	);
}
const solver = await DdsSolver.create();
let state = 9162026;
const randomBelow = (bound: number) => {
	state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
	return Math.floor((state / 2 ** 32) * bound);
};
const thresholds = [
	20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600, 750, 900, 1100, 1300,
	1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000,
];
const imps: number[] = [];
let calls = 0;
let inferenceMs = 0;
console.log(
	JSON.stringify({
		type: "protocol",
		deals: 16,
		seed: 9162026,
		policies,
		pairing: "NS sl/EW rl-fsp, then swapped",
		scoring: "double-dummy contract result, not actual card play",
		runtime: process.version,
	}),
);
for (let number = 1; number <= 16; number++) {
	const original = createBoard(number, dealCards(randomBelow));
	const scores: number[] = [];
	for (const nsPolicy of policies) {
		let board: Board = original;
		for (let turn = 0; turn < 320; turn++) {
			const status = boardStatus(board);
			if (status.phase !== "auction") break;
			const policy =
				status.actor === "N" || status.actor === "S"
					? nsPolicy
					: nsPolicy === "sl"
						? "rl-fsp"
						: "sl";
			const network = networks.get(policy);
			if (!network) throw new Error("missing bidder network");
			const started = performance.now();
			const chosen = network.choose(bidPosition(board, status.actor));
			inferenceMs += performance.now() - started;
			calls++;
			const result = applyAction(board, status.actor, {
				type: "call",
				call: chosen.call,
			});
			if (!result.ok) throw new Error(result.reason);
			board = result.board;
		}
		const end = boardStatus(board);
		if (end.phase === "auction") throw new Error("auction did not terminate");
		const contract = end.contract;
		const tricks =
			end.phase === "play"
				? 13 -
					Math.max(
						...solver
							.solve(end.remaining, end.contract.strain, end.current)
							.values(),
					)
				: 0;
		const scoreNS = scoreContract(
			contract ?? null,
			board.vulnerability,
			tricks,
		);
		scores.push(scoreNS);
		console.log(
			JSON.stringify({
				type: "table",
				number,
				nsPolicy,
				board,
				contract,
				tricks,
				scoreNS,
			}),
		);
	}
	const difference = (scores[1] ?? 0) - (scores[0] ?? 0);
	const imp =
		Math.sign(difference) *
		thresholds.filter((threshold) => Math.abs(difference) >= threshold).length;
	imps.push(imp);
	console.error(
		`Deal ${number}: RL/FSP ${imp >= 0 ? "+" : ""}${imp} IMPs against SL`,
	);
}
console.log(
	JSON.stringify({
		type: "summary",
		deals: imps.length,
		tables: imps.length * 2,
		calls,
		meanInferenceMs: inferenceMs / calls,
		rlImpsByDeal: imps,
		rlMeanImps: imps.reduce((a, b) => a + b, 0) / imps.length,
		scope:
			"small paired bidding sample scored double dummy; no general strength claim",
	}),
);
