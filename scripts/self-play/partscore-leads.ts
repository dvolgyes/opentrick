import { pathToFileURL } from "node:url";
import { DdsSolver, type DoubleDummySolver } from "../../src/bot/dds-solver";
import { playPosition } from "../../src/bot/play-position";
import {
	type Card,
	DECK,
	isDeal,
	RANKS,
	rankOf,
	SUITS,
	suitOf,
} from "../../src/bridge/cards";
import { SHAPES } from "../../src/bridge/convention-rules";
import { randomBelowFrom, shuffle } from "../../src/bridge/deal";
import { applyAction, boardStatus, createBoard } from "../../src/bridge/engine";
import { boardSetup, type Call } from "../../src/bridge/rules";
import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import type { BidOrigin } from "../../src/game/bridge";
import { seatAfter } from "../../src/protocol";
import { playPair, random } from "./arena";
import { type Advice, boardSearch } from "./defensive-search";
import { partnerOpening } from "./partner-opening";
import { summarize } from "./statistics";

const ARMS = ["high", "standard", "suit-only"] as const;
const DEALS = 128;
const FIRST_SEED = 9_400_000;
const LAYOUTS = 8;

function points(cards: readonly Card[]) {
	return cards.reduce(
		(sum, card) => sum + Math.max(0, 4 - RANKS.indexOf(rankOf(card))),
		0,
	);
}

export function partscoreDeal(seed: number, number: number) {
	const { dealer } = boardSetup(number);
	const overcaller = seatAfter(dealer, 1);
	const leader = seatAfter(dealer, 2);
	const advancer = seatAfter(dealer, 3);
	const weak = number % 2 === 1;
	const rng = random(seed);
	const below = randomBelowFrom(() => rng() * 2 ** 32);
	for (let draws = 1; draws <= 500_000; draws++) {
		const deck = shuffle(DECK, below);
		const opener = deck.slice(0, 13);
		const openPoints = points(opener);
		if (openPoints < 12 || openPoints > 16) continue;
		const lengths = SUITS.map(
			(suit) => opener.filter((card) => suitOf(card) === suit).length,
		);
		const opened = (lengths[1] ?? 0) > (lengths[0] ?? 0) ? "H" : "S";
		const openLength = lengths[SUITS.indexOf(opened)] ?? 0;
		if (openLength < 5 || lengths.some((length) => length > openLength))
			continue;
		const other = opened === "H" ? "S" : "H";
		const intervenor = deck.slice(13, 26);
		const overcallPoints = points(intervenor);
		if (overcallPoints < 9 || overcallPoints > 14) continue;
		const trump = intervenor
			.filter((card) => suitOf(card) === other)
			.map(rankOf);
		if (
			trump.length < 5 ||
			!SHAPES.goodSuit.some(
				({ honours, count }) =>
					trump.filter((rank) => honours.includes(rank)).length >= count,
			)
		)
			continue;
		const passing = deck.slice(26, 39);
		const leaderPoints = points(passing);
		const holding = passing.filter((card) => suitOf(card) === opened);
		if (
			(weak ? leaderPoints > 3 : leaderPoints < 4 || leaderPoints > 7) ||
			(leaderPoints >= 6 && holding.length >= 3)
		)
			continue;
		const raising = deck.slice(39);
		const raisePoints = points(raising);
		if (
			raisePoints < (opened === "H" ? 6 : 7) ||
			raisePoints > 9 ||
			raising.filter((card) => suitOf(card) === other).length < 3
		)
			continue;

		const deal = {
			[dealer]: opener,
			[overcaller]: intervenor,
			[leader]: passing,
			[advancer]: raising,
		};
		if (!isDeal(deal))
			throw new Error(`invalid complete deal for seed ${seed}`);
		const calls: readonly Call[] = [
			`1${opened}`,
			opened === "H" ? "1S" : "2H",
			"P",
			opened === "H" ? "2S" : "3H",
			"P",
			"P",
			"P",
		];
		let board = createBoard(number, deal);
		for (const [index, call] of calls.entries()) {
			const result = applyAction(board, seatAfter(dealer, index), {
				type: "call",
				call,
			});
			if (!result.ok)
				throw new Error(
					`illegal partscore auction for seed ${seed}: ${result.reason}`,
				);
			board = result.board;
		}
		const status = boardStatus(board);
		if (
			status.phase !== "play" ||
			status.actor !== leader ||
			status.contract.declarer !== overcaller ||
			status.contract.strain !== other ||
			status.contract.level !== (opened === "H" ? 2 : 3)
		)
			throw new Error(`invalid partscore contract for seed ${seed}`);
		const origins: (BidOrigin | null)[] = [
			{ controller: "seat", system: "hcp" },
			...calls.slice(1).map(() => null),
		];
		const { hints } = playPosition(board, leader, {}, origins);
		const hint = hints[0];
		if (
			hints.length !== 1 ||
			hint?.seat !== dealer ||
			hint.meaning.shape.kind !== "cards" ||
			hint.meaning.shape.suit !== opened ||
			hint.meaning.shape.min < 5
		)
			throw new Error(`missing natural opening hint for seed ${seed}`);
		const ranks = holding.map(rankOf);
		return {
			seed,
			board,
			hints,
			draws,
			weak,
			opened,
			leaderPoints,
			holding,
			honorLength:
				ranks.length >= 3 && ranks.some((rank) => RANKS.indexOf(rank) < 4),
			informative:
				ranks.length >= 3 &&
				ranks.filter((rank) => RANKS.indexOf(rank) < 5).length === 1 &&
				ranks.some((rank) => rank === "K" || rank === "Q" || rank === "J"),
		};
	}
	throw new Error(
		`no partscore deal for seed ${seed}, board ${number} after 500,000 draws`,
	);
}

export const suitOnly: Advice = (position, incumbent, ranked) => {
	const high = partnerOpening("high", position, incumbent);
	return high === undefined
		? undefined
		: ranked.find(({ card }) => suitOf(card) === suitOf(high))?.card;
};

export function contrast(candidate: number | null, control: number | null) {
	return candidate === null || control === null
		? 0
		: scoreDifferenceToImps(candidate - control);
}

function runBoard(
	solver: DoubleDummySolver,
	fixture: ReturnType<typeof partscoreDeal>,
) {
	const {
		board,
		hints,
		seed,
		draws,
		weak,
		opened,
		leaderPoints,
		holding,
		honorLength,
		informative,
	} = fixture;
	const search = boardSearch(solver, LAYOUTS, hints);
	let incumbent: Card | undefined;
	const arms = ARMS.map((arm) => {
		const baseline = search.policy();
		let proposed: Card | undefined;
		const candidate = search.policy((position, best, ranked) => {
			if (position.view.plays.length !== 0) return undefined;
			incumbent = best;
			proposed =
				arm === "suit-only"
					? suitOnly(position, best, ranked)
					: partnerOpening(arm, position, best);
			return proposed;
		});
		try {
			const { candidateNS, candidateEW } = playPair(
				board,
				baseline.play,
				candidate.play,
				seed,
			);
			const [defender, control] =
				board.dealer === "N" || board.dealer === "S"
					? [candidateNS, candidateEW]
					: [candidateEW, candidateNS];
			const lead = defender.cards[0] as Card;
			if (control.cards[0] !== incumbent)
				throw new Error("control opening lead differs from advice incumbent");
			return {
				proposed: proposed ?? null,
				lead,
				scores: [candidateNS.scoreNS, candidateEW.scoreNS],
				raw: candidateNS.scoreNS - candidateEW.scoreNS,
				baseline: baseline.counts,
				candidate: candidate.counts,
			};
		} catch (error) {
			return {
				proposed: proposed ?? null,
				lead: null,
				scores: null,
				raw: null,
				baseline: baseline.counts,
				candidate: candidate.counts,
				error: String(error),
			};
		}
	});
	return {
		seed,
		board: board.number,
		draws,
		weak,
		contract: board.calls[3],
		opened,
		leaderPoints,
		holding,
		honorLength,
		informative,
		incumbent: incumbent ?? null,
		arms,
		work: search.work,
	};
}

type Row = ReturnType<typeof runBoard>;
function report(rows: readonly Row[]) {
	const pairs = [
		[0, -1],
		[1, -1],
		[2, -1],
		[1, 0],
		[2, 0],
		[2, 1],
	] as const;
	return {
		holdings: {
			doubleton: rows.filter((row) => row.holding.length === 2).length,
			honorLength: rows.filter((row) => row.honorLength).length,
			informative: rows.filter((row) => row.informative).length,
			adviceAvailable: rows.filter((row) => row.arms[0]?.proposed != null)
				.length,
			rankOpportunities: rows.filter(
				(row) =>
					row.arms[0]?.proposed !== row.arms[1]?.proposed &&
					row.arms[0]?.proposed != null &&
					row.arms[1]?.proposed != null,
			).length,
		},
		work: {
			searches: rows.reduce((sum, row) => sum + row.work.searches, 0),
			ddsCalls: rows.reduce((sum, row) => sum + row.work.ddsCalls, 0),
		},
		arms: ARMS.map((arm, i) => ({
			arm,
			failures: rows.filter((row) => row.arms[i]?.raw === null).length,
			changes: rows.reduce(
				(sum, row) => sum + (row.arms[i]?.candidate.changed ?? 0),
				0,
			),
			vetoes: rows.reduce(
				(sum, row) => sum + (row.arms[i]?.candidate.veto ?? 0),
				0,
			),
			decisions: rows.reduce(
				(sum, row) =>
					sum +
					(row.arms[i]?.candidate.decisions ?? 0) +
					(row.arms[i]?.baseline.decisions ?? 0),
				0,
			),
			layouts: rows.reduce(
				(sum, row) =>
					sum +
					(row.arms[i]?.candidate.layouts ?? 0) +
					(row.arms[i]?.baseline.layouts ?? 0),
				0,
			),
		})),
		comparisons: pairs.map(([a, b]) => ({
			candidate: ARMS[a],
			control: b === -1 ? "incumbent" : ARMS[b],
			...summarize(
				rows.map((row) =>
					contrast(
						row.arms[a]?.raw ?? null,
						b === -1 ? 0 : (row.arms[b]?.raw ?? null),
					),
				),
			),
			withinSuitChanges: rows.filter((row) => {
				const candidate = row.arms[a]?.lead;
				const control = b === -1 ? row.incumbent : row.arms[b]?.lead;
				return (
					candidate &&
					control &&
					candidate !== control &&
					suitOf(candidate) === suitOf(control)
				);
			}).length,
		})),
	};
}

if (
	process.argv[1] &&
	pathToFileURL(process.argv[1]).href === import.meta.url
) {
	const corpus = Array.from({ length: DEALS }, (_, i) =>
		partscoreDeal(FIRST_SEED + i, i + 1),
	);
	if (process.argv.includes("--preflight")) {
		console.error(
			`Validated ${corpus.length} deals; maximum ${Math.max(...corpus.map(({ draws }) => draws))} draws`,
		);
	} else {
		const solver = await DdsSolver.create();
		const rows = corpus.map((fixture) => {
			const row = runBoard(solver, fixture);
			console.log(JSON.stringify(row));
			return row;
		});
		console.error(
			JSON.stringify(
				{
					all: report(rows),
					weak: report(rows.filter(({ weak }) => weak)),
					strong: report(rows.filter(({ weak }) => !weak)),
				},
				null,
				2,
			),
		);
	}
}
