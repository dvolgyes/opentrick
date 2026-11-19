import type { DoubleDummySolver } from "../../src/bot/dds-solver";
import type { PlayPosition } from "../../src/bot/play-position";
import {
	createHandSampler,
	type RemainingHands,
} from "../../src/bot/play-sampling";
import {
	type Card,
	RANKS,
	rankOf,
	SUITS,
	suitOf,
} from "../../src/bridge/cards";
import type { CurrentTrick } from "../../src/bridge/engine";
import { scoreContract } from "../../src/bridge/rules";
import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import { type Seat, seatAfter } from "../../src/protocol";
import { holdUpFork } from "./hold-up";

interface PublicNode {
	visits: number;
	total: number;
	legal?: readonly Card[];
	children?: Map<Card, PublicNode>;
}

function isNS(seat: Seat): boolean {
	return seat === "N" || seat === "S";
}

function rank(card: Card): number {
	return RANKS.indexOf(rankOf(card));
}

function publicOrder(a: Card, b: Card): number {
	return (
		rank(b) - rank(a) || SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b))
	);
}

function legalInOrder(hand: readonly Card[], lead: Card | undefined): Card[] {
	const suit = lead && suitOf(lead);
	const ordered = hand.toSorted(publicOrder);
	if (!suit) return ordered;
	const followers = ordered.filter((card) => suitOf(card) === suit);
	return followers.length ? followers : ordered;
}

function winningIndex(cards: readonly Card[]): number {
	const lead = cards[0];
	if (!lead) throw new Error("cannot find a winner in an empty trick");
	let winner = 0;
	let best = rank(lead);
	for (const [index, card] of cards.entries()) {
		const value = rank(card);
		if (suitOf(card) === suitOf(lead) && value < best) {
			winner = index;
			best = value;
		}
	}
	return winner;
}

export function holdUpDefenderCard(
	hand: readonly Card[],
	current: CurrentTrick,
): Card {
	const lead = current.cards[0];
	const legal = legalInOrder(hand, lead);
	const lowest = legal[0];
	if (!lowest) throw new Error("hold-up defender has no legal play");
	if (lead) {
		const winner = winningIndex(current.cards);
		const winningCard = current.cards[winner];
		if (
			!winningCard ||
			winner % 2 === current.cards.length % 2 ||
			suitOf(lowest) !== suitOf(lead)
		)
			return lowest;
		return legal.find((card) => rank(card) < rank(winningCard)) ?? lowest;
	}

	let longest: Card[] = [];
	for (const suit of SUITS) {
		const suited = legal.filter((card) => suitOf(card) === suit);
		if (suited.length > longest.length) longest = suited;
	}
	const top = longest.at(-1);
	const second = longest.at(-2);
	if (
		top &&
		second &&
		rank(top) <= RANKS.indexOf("T") &&
		rank(second) === rank(top) + 1
	)
		return top;
	return longest.at(-4) ?? longest[0] ?? lowest;
}

export function holdUpLeafTricks(
	hands: RemainingHands,
	leader: Seat,
	declarer: Seat,
	declarerTricks: number,
	solver: DoubleDummySolver,
): number {
	const remaining = hands[leader].length;
	if (!remaining) return declarerTricks;
	let best = -Infinity;
	for (const tricks of solver
		.solve(hands, "NT", { leader, cards: [] })
		.values())
		best = Math.max(best, tricks);
	if (best === -Infinity) throw new Error("hold-up leaf has no DDS score");
	return (
		declarerTricks + (isNS(leader) === isNS(declarer) ? best : remaining - best)
	);
}

export function holdUpUcb(
	parentVisits: number,
	visits: number,
	mean: number,
	bias: boolean,
): number {
	return (
		mean +
		6 * Math.sqrt(Math.log(parentVisits) / visits) +
		(bias ? 2 / (1 + visits) : 0)
	);
}

function selectCard(
	node: PublicNode,
	legal: readonly Card[],
	biasedDuck: Card | undefined,
): Card {
	let best: Card | undefined;
	let bestValue = -Infinity;
	for (const card of legal) {
		const child = node.children?.get(card);
		if (!child?.visits) return card;
		const value = holdUpUcb(
			node.visits,
			child.visits,
			child.total / child.visits,
			card === biasedDuck,
		);
		if (value > bestValue) {
			bestValue = value;
			best = card;
		}
	}
	if (!best) throw new Error("hold-up decision has no legal play");
	return best;
}

export function searchHoldUp(
	p: PlayPosition,
	solver: DoubleDummySolver,
	random: () => number,
	biased: boolean,
	timeMs: number,
	iterations?: number,
): {
	card: Card;
	iterations: number;
	nodes: number;
	elapsedMs: number;
	root: readonly { card: Card; visits: number; mean: number }[];
	revisits: number;
} {
	const start = performance.now();
	const fork = holdUpFork(p);
	if (!fork) throw new Error("hold-up search requires an eligible fork");
	const biasedDuck = biased && fork.bias ? fork.duck : undefined;
	const legal = p.legal.toSorted(publicOrder);
	const sample = createHandSampler(p.view);
	const { declarer } = p.contract;
	const sign = isNS(declarer) ? 1 : -1;
	const reference = scoreContract(p.contract, p.vulnerability, 9);
	const utility = Array.from({ length: 14 }, (_, tricks) =>
		scoreDifferenceToImps(
			sign * (scoreContract(p.contract, p.vulnerability, tricks) - reference),
		),
	);
	const root: PublicNode = { visits: 0, total: 0 };
	const path = [root];
	let nodes = 1;
	let revisits = 0;
	do {
		const hands = sample(random);
		let leader = p.current.leader;
		const cards = [...p.current.cards];
		let turn = p.turn;
		let declarerTricks = p.declarerTricks;
		let node = root;
		for (let action = 0; action < 5; action++) {
			const declarerActs = isNS(turn) === isNS(declarer);
			const hand = hands[turn];
			let card: Card;
			if (action === 0) {
				card = selectCard(root, legal, biasedDuck);
			} else if (declarerActs) {
				if (node.visits) revisits++;
				node.legal ??= legalInOrder(hand, cards[0]);
				card = selectCard(node, node.legal, undefined);
			} else {
				card = holdUpDefenderCard(hand, { leader, cards });
			}
			hands[turn] = hand.filter((held) => held !== card);
			cards.push(card);
			if (cards.length === 4) {
				leader = seatAfter(leader, winningIndex(cards));
				if (isNS(leader) === isNS(declarer)) declarerTricks++;
				cards.length = 0;
			}
			turn = seatAfter(leader, cards.length);
			node.children ??= new Map();
			const children = node.children;
			let next = children.get(card);
			if (!next) {
				next = { visits: 0, total: 0 };
				children.set(card, next);
				nodes++;
			}
			node = next;
			path[action + 1] = node;
		}
		const tricks = holdUpLeafTricks(
			hands,
			leader,
			declarer,
			declarerTricks,
			solver,
		);
		const reward = utility[tricks];
		if (reward === undefined)
			throw new Error("invalid hold-up leaf trick total");
		for (const visited of path) {
			visited.visits++;
			visited.total += reward;
		}
	} while (
		(iterations === undefined || root.visits < iterations) &&
		performance.now() - start < timeMs
	);

	const stats = legal.map((card) => {
		const child = root.children?.get(card);
		const visits = child?.visits ?? 0;
		return { card, visits, mean: child && visits ? child.total / visits : 0 };
	});
	let best = stats[0];
	if (!best) throw new Error("hold-up search has no root card");
	for (const candidate of stats) {
		if (
			candidate.visits > best.visits ||
			(candidate.visits === best.visits && candidate.mean > best.mean)
		)
			best = candidate;
	}
	return {
		card: best.card,
		iterations: root.visits,
		nodes,
		elapsedMs: performance.now() - start,
		root: stats,
		revisits,
	};
}
