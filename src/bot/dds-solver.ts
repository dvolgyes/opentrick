import { Dds, loadDds } from "bridge-dds";
import {
	type Card,
	isCard,
	RANKS,
	rankOf,
	SUITS,
	sortCards,
	suitOf,
} from "../bridge/cards";
import type { CurrentTrick } from "../bridge/engine";
import type { Strain } from "../bridge/rules";
import { SEATS, seatAfter } from "../protocol";
import type { RemainingHands } from "./play-sampling";

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
		const cards = [...SEATS.flatMap((seat) => hands[seat]), ...current.cards];
		if (
			cards.some((card) => !isCard(card)) ||
			new Set(cards).size !== cards.length
		)
			throw new Error("DDS input contains invalid or duplicate cards");
		if (
			current.cards.length > 3 ||
			cards.length === 0 ||
			cards.length > 52 ||
			cards.length % 4 !== 0
		)
			throw new Error("DDS input has inconsistent trick or card counts");
		const first = SEATS.indexOf(current.leader);
		if (first < 0 || (trump !== "NT" && !SUITS.includes(trump)))
			throw new Error("DDS input has invalid leader or trump");
		for (let i = 0; i < 4; i++) {
			const seat = seatAfter(current.leader, i);
			if (
				hands[seat].length !==
				cards.length / 4 - (i < current.cards.length ? 1 : 0)
			)
				throw new Error("DDS input has inconsistent remaining hand sizes");
		}
		const result = this.dds.SolveBoardPBN(
			{
				trump: trump === "NT" ? 4 : SUITS.indexOf(trump),
				first,
				currentTrickSuit: current.cards.map((card) =>
					SUITS.indexOf(suitOf(card)),
				),
				currentTrickRank: current.cards.map(
					(card) => 14 - RANKS.indexOf(rankOf(card)),
				),
				remainCards: `N:${SEATS.map((seat) =>
					SUITS.map((suit) =>
						sortCards(hands[seat])
							.filter((card) => suitOf(card) === suit)
							.map(rankOf)
							.join(""),
					).join("."),
				).join(" ")}`,
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
				score > cards.length / 4
			)
				throw new Error("DDS returned an invalid trick score");
			for (let rank = 2; rank <= 14; rank++) {
				if (
					rank === result.rank[i] ||
					((result.equals[i] ?? 0) & (1 << rank)) !== 0
				) {
					const value = RANKS[14 - rank];
					if (value) scores.set(`${suit}${value}`, score);
				}
			}
		}
		return scores;
	}
}
