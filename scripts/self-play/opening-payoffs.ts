import type { DoubleDummySolver } from "../../src/bot/dds-solver";
import type { CardEvaluation } from "../../src/bot/play-engine";
import type { PlayPosition } from "../../src/bot/play-position";
import { type Card, suitOf } from "../../src/bridge/cards";
import { type Board, boardStatus, parseBoard } from "../../src/bridge/engine";
import { type PlayPolicy, playTable } from "./arena";
import { boardSearch } from "./defensive-search";
import { partnerOpening } from "./partner-opening";

export interface LeadPayoff {
	card: Card;
	gap: number;
	points: number;
}

export interface OpeningPayoffs {
	incumbent: LeadPayoff;
	ranked: LeadPayoff;
	standard: LeadPayoff;
	high: LeadPayoff;
	calls: number;
	tables: number;
}

export function openingPayoffs(
	solver: DoubleDummySolver,
	board: Board,
	hints: PlayPosition["hints"],
	samples: number,
	seed: number,
): OpeningPayoffs {
	if (!Number.isSafeInteger(seed))
		throw new Error(`invalid search seed: ${seed}`);
	const start = parseBoard(board);
	if (start?.cards.length !== 0)
		throw new Error("lead payoffs require a legal opening position");
	const status = boardStatus(start);
	if (status.phase !== "play")
		throw new Error("lead payoffs require a legal opening position");
	const sign = status.actor === "N" || status.actor === "S" ? 1 : -1;
	const search = boardSearch(solver, samples, hints);
	const baseline = search.policy().play;
	let opening:
		| { position: PlayPosition; scores: readonly CardEvaluation[] }
		| undefined;
	const capture = search.policy((position, _, scores) => {
		opening = { position, scores };
		return undefined;
	}).play;
	const controlPolicy: PlayPolicy = (position, random) =>
		(position.view.plays.length === 0 ? capture : baseline)(position, random);
	const control = playTable(start, controlPolicy, controlPolicy, seed);
	const incumbent = control.cards[0];
	const best = opening?.scores[0];
	if (!opening || !best || incumbent !== best.card)
		throw new Error("missing incumbent opening evaluation");
	const scores = opening.scores;
	const high = partnerOpening("high", opening.position, incumbent);
	const standard = partnerOpening("standard", opening.position, incumbent);
	const suit = high === undefined ? undefined : suitOf(high);
	const ranked =
		suit === undefined
			? undefined
			: scores.find(({ card }) => suitOf(card) === suit)?.card;
	const payoffs = new Map<Card, LeadPayoff>();
	const controlPayoff = {
		card: incumbent,
		gap: 0,
		points: sign * control.scoreNS,
	};
	payoffs.set(incumbent, controlPayoff);
	const bestUtility = best.utility;

	const replay = (card: Card = incumbent): LeadPayoff => {
		const saved = payoffs.get(card);
		if (saved) return saved;
		const scored = scores.find((entry) => entry.card === card);
		if (!scored) throw new Error(`${card} is not a scored opening lead`);
		const policy: PlayPolicy = (position, random) =>
			position.view.plays.length === 0 ? card : baseline(position, random);
		const table = playTable(start, policy, policy, seed);
		const payoff = {
			card,
			gap: bestUtility - scored.utility,
			points: sign * table.scoreNS,
		};
		payoffs.set(card, payoff);
		return payoff;
	};

	return {
		incumbent: controlPayoff,
		ranked: replay(ranked),
		standard: replay(standard),
		high: replay(high),
		calls: search.work.ddsCalls,
		tables: payoffs.size,
	};
}
