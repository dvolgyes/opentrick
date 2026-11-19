import { type Card, rankOf, suitOf } from "../../src/bridge/cards";
import { dealCards, randomBelowFrom } from "../../src/bridge/deal";
import {
	applyAction,
	type Board,
	boardStatus,
	createBoard,
} from "../../src/bridge/engine";
import {
	boardSetup,
	type Call,
	type Level,
	STRAINS,
} from "../../src/bridge/rules";
import { seatAfter } from "../../src/protocol";
import { random } from "./arena";

const LOW_LEVELS = [1, 2, 2, 1, 3, 2, 2, 2] as const;
const MAX_PROPOSALS = 2_000_000;

function hcp(hand: readonly Card[]): number {
	let points = 0;
	for (const card of hand) points += "JQKA".indexOf(rankOf(card)) + 1;
	return points;
}

function balanced(hand: readonly Card[]): boolean {
	const lengths = { S: 0, H: 0, D: 0, C: 0 };
	for (const card of hand) lengths[suitOf(card)]++;
	let doubletons = 0;
	for (const length of Object.values(lengths)) {
		if (length < 2 || length > 5) return false;
		if (length === 2 && ++doubletons > 1) return false;
	}
	return true;
}

/** Select the first shuffled deal matching this matrix cell, then apply its frozen auction. */
export function mixedDeal(index: number, seed: number): Board {
	if (!Number.isInteger(index) || index < 0 || index >= 80)
		throw new Error(
			`mixed deal index must be an integer from 0 to 79: ${index}`,
		);
	const strain = STRAINS[index % 5];
	if (!strain) throw new Error(`missing strain for mixed deal ${index}`);
	const profile = Math.floor(index / 5);
	const minor = strain === "C" || strain === "D";
	const lowLevel = LOW_LEVELS[profile];
	const gameLevel = strain === "NT" ? 3 : minor ? 5 : 4;
	const level: Level =
		profile === 4 && strain === "NT"
			? 2
			: (lowLevel ?? (profile === 15 ? 7 : profile === 14 ? 6 : gameLevel));
	const doubling = profile === 7 ? "XX" : profile === 6 ? "X" : "";
	let min = minor ? 27 : 25;
	let max = minor ? 32 : 31;
	if (lowLevel) [min, max] = [18, 24];
	else if (level === 6) [min, max] = [30, 34];
	else if (level === 7) [min, max] = [34, 37];
	const number = index + 1;
	const { dealer } = boardSetup(number);
	const partner = seatAfter(dealer, 2);
	const rng = random(seed);
	const below = randomBelowFrom(() => rng() * 2 ** 32);
	for (let proposal = 0; proposal < MAX_PROPOSALS; proposal++) {
		const deal = dealCards(below);
		const declarerHand = deal[dealer];
		const partnerHand = deal[partner];
		const declarerHcp = hcp(declarerHand);
		const partnerHcp = hcp(partnerHand);
		const points = declarerHcp + partnerHcp;
		if (points < min || points > max) continue;
		if (strain === "NT") {
			if (declarerHcp < partnerHcp || !balanced(declarerHand)) continue;
		} else {
			let declarerTrumps = 0;
			let partnerTrumps = 0;
			for (const card of declarerHand)
				if (suitOf(card) === strain) declarerTrumps++;
			for (const card of partnerHand)
				if (suitOf(card) === strain) partnerTrumps++;
			if (declarerTrumps + partnerTrumps < 8 || declarerTrumps < partnerTrumps)
				continue;
		}
		let board = createBoard(number, deal);
		const calls: Call[] = [`${level}${strain}`];
		if (doubling) calls.push("X");
		if (doubling === "XX") calls.push("XX");
		calls.push("P", "P", "P");
		for (const [offset, call] of calls.entries()) {
			const result = applyAction(board, seatAfter(dealer, offset), {
				type: "call",
				call,
			});
			if (!result.ok) throw new Error(`mixed deal ${index}: ${result.reason}`);
			board = result.board;
		}
		const status = boardStatus(board);
		if (
			status.phase !== "play" ||
			status.contract.level !== level ||
			status.contract.strain !== strain ||
			status.contract.declarer !== dealer ||
			status.contract.doubling !== doubling
		)
			throw new Error(
				`mixed deal ${index}: auction did not produce its matrix contract`,
			);
		return board;
	}
	throw new Error(
		`mixed deal ${index}: no accepted deal in ${MAX_PROPOSALS} proposals`,
	);
}
