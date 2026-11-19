import { Dds, loadDds } from "bridge-dds";
import { type Card, DECK, RANKS, SUITS } from "../bridge/cards";
import type { CurrentTrick } from "../bridge/engine";
import type { Strain } from "../bridge/rules";
import { SEATS } from "../protocol";
import type { RemainingHands } from "./play-sampling";

const cardCodes = new Map<string, number>(
	DECK.map((card, index) => [
		card,
		(Math.floor(index / RANKS.length) << 4) | (index % RANKS.length),
	]),
);

export interface DoubleDummySolver {
	/** Future tricks for the partnership whose card is next, including this partial trick. */
	solve(
		hands: RemainingHands,
		trump: Strain,
		current: CurrentTrick,
	): ReadonlyMap<Card, number>;
}

/** Owns the DDS representation and validates its bounded native-memory input. */
export class DdsSolver implements DoubleDummySolver {
	private constructor(private readonly dds: Dds) {}

	static async create(): Promise<DdsSolver> {
		return new DdsSolver(new Dds(await loadDds()));
	}

	solve(
		hands: RemainingHands,
		trump: Strain,
		current: CurrentTrick,
	): ReadonlyMap<Card, number> {
		const played = current.cards.length;
		let cardCount = played;
		for (const seat of SEATS) cardCount += hands[seat].length;
		if (played > 3 || cardCount === 0 || cardCount > 52 || cardCount % 4 !== 0)
			throw new Error("DDS input has inconsistent trick or card counts");
		const first = SEATS.indexOf(current.leader);
		if (first < 0 || (trump !== "NT" && !SUITS.includes(trump)))
			throw new Error("DDS input has invalid leader or trump");
		const tricks = cardCount / 4;
		const seen = [0, 0, 0, 0];
		const currentTrickSuit: number[] = [];
		const currentTrickRank: number[] = [];
		for (const card of current.cards) {
			const code = cardCodes.get(card);
			if (code === undefined)
				throw new Error("DDS input contains invalid or duplicate cards");
			const suit = code >> 4;
			const rank = code & 15;
			const bit = 1 << rank;
			const prior = seen[suit] ?? 0;
			if (prior & bit)
				throw new Error("DDS input contains invalid or duplicate cards");
			seen[suit] = prior | bit;
			currentTrickSuit.push(suit);
			currentTrickRank.push(14 - rank);
		}

		let remainCards = "N:";
		const handRanks = [0, 0, 0, 0];
		let seatIndex = 0;
		for (const seat of SEATS) {
			const hand = hands[seat];
			const offset = (seatIndex - first + 4) % 4;
			if (hand.length !== tricks - (offset < played ? 1 : 0))
				throw new Error("DDS input has inconsistent remaining hand sizes");
			for (const card of hand) {
				const code = cardCodes.get(card);
				if (code === undefined)
					throw new Error("DDS input contains invalid or duplicate cards");
				const suit = code >> 4;
				const bit = 1 << (code & 15);
				const prior = seen[suit] ?? 0;
				if (prior & bit)
					throw new Error("DDS input contains invalid or duplicate cards");
				seen[suit] = prior | bit;
				handRanks[suit] = (handRanks[suit] ?? 0) | bit;
			}
			if (seatIndex > 0) remainCards += " ";
			for (let suit = 0; suit < 4; suit++) {
				if (suit > 0) remainCards += ".";
				let ranks = handRanks[suit] ?? 0;
				while (ranks !== 0) {
					remainCards += RANKS[31 - Math.clz32(ranks & -ranks)];
					ranks &= ranks - 1;
				}
				handRanks[suit] = 0;
			}
			seatIndex++;
		}
		const result = this.dds.SolveBoardPBN(
			{
				trump: trump === "NT" ? 4 : SUITS.indexOf(trump),
				first,
				currentTrickSuit,
				currentTrickRank,
				remainCards,
			},
			-1,
			3,
			1,
		);
		const scores = new Map<Card, number>();
		if (
			!Number.isInteger(result.cards) ||
			result.cards < 1 ||
			result.cards > 13
		)
			throw new Error("DDS returned an invalid candidate count");
		for (let i = 0; i < result.cards; i++) {
			const suitIndex = result.suit[i];
			const suit = suitIndex === undefined ? undefined : SUITS[suitIndex];
			const score = result.score[i];
			if (
				!suit ||
				score === undefined ||
				!Number.isInteger(score) ||
				score < 0 ||
				score > tricks
			)
				throw new Error("DDS returned an invalid trick score");
			const rank = result.rank[i];
			let ranks = (result.equals[i] ?? 0) & 0x7ffc;
			if (
				rank !== undefined &&
				Number.isInteger(rank) &&
				rank >= 2 &&
				rank <= 14
			)
				ranks |= 1 << rank;
			const suitOffset = (suitIndex ?? 0) * RANKS.length;
			while (ranks !== 0) {
				const card = DECK[suitOffset + Math.clz32(ranks & -ranks) - 17];
				if (card) scores.set(card, score);
				ranks &= ranks - 1;
			}
		}
		return scores;
	}
}
