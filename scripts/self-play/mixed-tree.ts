import type { DoubleDummySolver } from "../../src/bot/dds-solver";
import type { PlayPosition } from "../../src/bot/play-position";
import { createHandSampler } from "../../src/bot/play-sampling";
import { type Card, suitOf } from "../../src/bridge/cards";
import { scoreContract, trickWinner } from "../../src/bridge/rules";
import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import { type Seat, seatAfter } from "../../src/protocol";
import { modelCard, publicOrder } from "./mixed-policy";

interface Action {
	readonly card: Card;
	visits: number;
	total: number;
}

interface Decision {
	readonly actions: readonly Action[];
	visits: number;
	model?: Card;
}

function isNS(seat: Seat): boolean {
	return seat === "N" || seat === "S";
}

function legalInOrder(hand: readonly Card[], lead: Card | undefined): Card[] {
	if (lead !== undefined) {
		const suit = suitOf(lead);
		const followers = hand.filter((card) => suitOf(card) === suit);
		if (followers.length) return followers.sort(publicOrder);
	}
	return hand.toSorted(publicOrder);
}

function action(card: Card, total = 0): Action {
	return { card, visits: 0, total };
}

function selectVisited(decision: Decision, prior: number): Action {
	const logVisits = Math.log1p(decision.visits);
	let winner: Action | undefined;
	let best = -Infinity;
	for (const candidate of decision.actions) {
		const { card, total, visits } = candidate;
		const ucb =
			total / (visits + prior) +
			6 * Math.sqrt(logVisits / visits) +
			(card === decision.model ? 2 / (1 + visits) : 0);
		if (ucb > best) {
			best = ucb;
			winner = candidate;
		}
	}
	if (!winner) throw new Error("mixed search has no visited action");
	return winner;
}

/** Two-trick information-set search; DDS sees sampled truth only for the seed and horizon. */
export function searchMixed(
	p: PlayPosition,
	solver: DoubleDummySolver,
	rng: () => number,
	biased: boolean,
	timeMs: number,
	iterations?: number,
): {
	card: Card;
	simulations: number;
	rootCoverage: number;
	rootLegal: number;
	elapsedMs: number;
	revisits: number;
	ddsCalls: number;
} {
	const start = performance.now();
	const sample = createHandSampler(p.view);
	const { declarer, level, strain } = p.contract;
	const controller = p.view.seat;
	const declaring = controller === declarer;
	const declarerNS = isNS(declarer);
	const sign = isNS(controller) ? 1 : -1;
	const beforeOpening = p.view.plays.length === 0;
	const remaining = 13 - Math.floor(p.view.plays.length / 4);
	const horizon = Math.min(2, remaining);
	const reference = scoreContract(p.contract, p.vulnerability, level + 6);
	const utility = Array.from({ length: 14 }, (_, tricks) =>
		scoreDifferenceToImps(
			sign * (scoreContract(p.contract, p.vulnerability, tricks) - reference),
		),
	);
	const rewardFor = (tricks: number): number => {
		const reward = utility[tricks];
		if (reward === undefined)
			throw new Error("invalid mixed search trick total");
		return reward;
	};

	const seed = solver.solve(sample(rng), strain, p.current);
	const root: Decision = {
		visits: 0,
		actions: p.legal.toSorted(publicOrder).map((card) => {
			const tricks = seed.get(card);
			if (tricks === undefined)
				throw new Error(`DDS omitted root card ${card}`);
			return action(
				card,
				rewardFor(p.declarerTricks + (declaring ? tricks : remaining - tricks)),
			);
		}),
	};
	const expansionOrder = root.actions.toSorted((a, b) => b.total - a.total);
	const decisions = new Map<string, Decision>();
	const path: { decision: Decision; selected: Action }[] = [];
	let rootCoverage = 0;
	let revisits = 0;
	let ddsCalls = 1;
	while (
		(iterations === undefined || root.visits < iterations) &&
		performance.now() - start < timeMs
	) {
		const hands = sample(rng);
		const current = { leader: p.current.leader, cards: [...p.current.cards] };
		let turn = p.turn;
		let declarerTricks = p.declarerTricks;
		let completed = 0;
		let publicPath = "";
		path.length = 0;
		while (completed < horizon) {
			const hand = hands[turn];
			let card: Card;
			if (turn === controller || (declaring && turn === p.view.dummy)) {
				const isRoot = publicPath === "";
				let decision = isRoot ? root : decisions.get(publicPath);
				if (!decision) {
					decision = {
						visits: 0,
						actions: legalInOrder(hand, current.cards[0]).map((candidate) =>
							action(candidate),
						),
					};
					decisions.set(publicPath, decision);
				} else if (!isRoot && decision.visits) {
					revisits++;
				}
				let selected = isRoot
					? expansionOrder[rootCoverage]
					: decision.actions.find((candidate) => candidate.visits === 0);
				if (!selected) {
					if (biased) decision.model ??= modelCard(hand, current, strain);
					selected = selectVisited(decision, Number(isRoot));
				}
				card = selected.card;
				path.push({ decision, selected });
			} else {
				card = modelCard(hand, current, strain);
			}
			hands[turn] = hand.filter((held) => held !== card);
			if (publicPath === "" && beforeOpening) {
				publicPath = `${card}:${hands[p.view.dummy].toSorted(publicOrder).join("")}:`;
			} else {
				publicPath += card;
			}
			current.cards.push(card);
			if (current.cards.length === 4) {
				current.leader = trickWinner(current.cards, current.leader, strain);
				if (isNS(current.leader) === declarerNS) declarerTricks++;
				current.cards.length = 0;
				completed++;
			}
			turn = seatAfter(current.leader, current.cards.length);
		}
		if (remaining > completed) {
			let best = -Infinity;
			for (const tricks of solver.solve(hands, strain, current).values()) {
				best = Math.max(best, tricks);
			}
			ddsCalls++;
			if (best === -Infinity)
				throw new Error("mixed search leaf has no DDS score");
			declarerTricks +=
				isNS(turn) === declarerNS ? best : remaining - completed - best;
		}
		const reward = rewardFor(declarerTricks);
		for (const { decision, selected } of path) {
			if (decision === root && selected.visits === 0) rootCoverage++;
			decision.visits++;
			selected.visits++;
			selected.total += reward;
		}
	}

	const fullCoverage = rootCoverage === root.actions.length;
	let best: Action | undefined;
	for (const candidate of root.actions) {
		const visitDifference =
			fullCoverage && best ? candidate.visits - best.visits : 0;
		if (
			!best ||
			visitDifference > 0 ||
			(visitDifference === 0 &&
				candidate.total / (candidate.visits + 1) >
					best.total / (best.visits + 1))
		) {
			best = candidate;
		}
	}
	if (!best) throw new Error("mixed search has no root card");
	return {
		card: best.card,
		simulations: root.visits,
		rootCoverage,
		rootLegal: root.actions.length,
		elapsedMs: performance.now() - start,
		revisits,
		ddsCalls,
	};
}
