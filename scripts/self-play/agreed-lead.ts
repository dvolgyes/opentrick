import { pathToFileURL } from "node:url";
import { DdsSolver, type DoubleDummySolver } from "../../src/bot/dds-solver";
import { type PlayPosition, playPosition } from "../../src/bot/play-position";
import {
	createHandSampler,
	type RemainingHands,
} from "../../src/bot/play-sampling";
import { mapLegalRankClasses } from "../../src/bot/rank-classes";
import {
	type Card,
	RANKS,
	rankOf,
	SUITS,
	sortCards,
	suitOf,
} from "../../src/bridge/cards";
import {
	applyAction,
	type Board,
	boardStatus,
	scoreBoard,
} from "../../src/bridge/engine";
import { scoreContract } from "../../src/bridge/rules";
import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import { SEATS, type Seat, seatAfter } from "../../src/protocol";
import { makeBoard, type PlayPolicy, random } from "./arena";
import { summarize } from "./statistics";

const ARMS = ["I", "S", "D"] as const;
type Arm = (typeof ARMS)[number];
const SAMPLES = 3;
const MAX_PROPOSALS = 4096;

interface Work {
	decisions: number;
	conditioned: number;
	proposals: number;
	solves: number;
}

export function workCounts(): Work {
	return { decisions: 0, conditioned: 0, proposals: 0, solves: 0 };
}

export function openingFourth(hand: readonly Card[]): Card {
	const sorted = sortCards(hand);
	let longest: Card[] = [];
	for (const suit of SUITS) {
		const holding = sorted.filter((card) => suitOf(card) === suit);
		if (holding.length > longest.length) longest = holding;
	}
	const card = longest[3];
	if (!card) throw new Error("opening agreement requires a 13-card hand");
	return card;
}

function is3NT(position: PlayPosition): boolean {
	return position.contract.strain === "NT" && position.contract.level === 3;
}

const agreement = Symbol("from the opening lead");
interface AgreedOpening {
	readonly [agreement]: true;
	readonly leader: Seat;
	readonly card: Card;
}

export function agreedOpener(position: PlayPosition): AgreedOpening {
	const leader = seatAfter(position.contract.declarer, 1);
	if (
		!is3NT(position) ||
		position.view.plays.length ||
		position.view.seat !== leader ||
		position.turn !== leader ||
		position.view.own.length !== 13
	)
		throw new Error("agreement starts at the opening lead of a full 3NT board");
	return { [agreement]: true, leader, card: openingFourth(position.view.own) };
}

interface Signal {
	readonly leader: Seat;
	readonly higher: readonly Card[];
	readonly need: number;
}

export function openingSignal(
	position: PlayPosition,
	opening?: AgreedOpening,
): Signal | undefined {
	if (!opening || !is3NT(position)) return undefined;
	const leader = seatAfter(position.contract.declarer, 1);
	const receiver = seatAfter(leader, 2);
	const first = position.view.plays[0];
	if (
		position.view.seat !== receiver ||
		position.turn !== receiver ||
		opening.leader !== leader ||
		first?.seat !== leader ||
		first.card !== opening.card
	)
		return undefined;
	const suit = suitOf(first.card);
	const cut = RANKS.indexOf(rankOf(first.card));
	const higher = new Set(
		RANKS.slice(0, cut).map((rank): Card => `${suit}${rank}`),
	);
	let need = 3;
	for (const { seat, card } of position.view.plays) {
		if (higher.delete(card) && seat === leader) need--;
	}
	// The receiver and dummy cannot supply any of the leader's original ranks.
	for (const card of position.view.own) higher.delete(card);
	for (const card of position.view.dummyCards ?? []) higher.delete(card);
	return { leader, higher: [...higher], need };
}

export function proposeLayout(
	sample: (random: () => number) => RemainingHands,
	random: () => number,
	signal: Signal | undefined,
	work: Work,
): RemainingHands {
	for (let attempt = 0; attempt < MAX_PROPOSALS; attempt++) {
		work.proposals++;
		const hands = sample(random);
		if (!signal) return hands;
		const holding = hands[signal.leader];
		let count = 0;
		for (const card of signal.higher) if (holding.includes(card)) count++;
		if (count === signal.need) return hands;
	}
	throw new Error(
		`agreed lead rejection exhausted ${MAX_PROPOSALS} proposals for one layout`,
	);
}

function isNS(seat: Seat): boolean {
	return seat === "N" || seat === "S";
}

/** Incumbent ranking, with a fixed budget and no clock, exact enumeration or auction weights. */
export function createDecision(
	solver: DoubleDummySolver,
	work: Work,
	opening?: AgreedOpening,
): PlayPolicy {
	return (position, random) => {
		const only = position.legal[0];
		if (!only || !is3NT(position) || position.hints.length)
			throw new Error("expected a legal 3NT play without auction hints");
		if (position.legal.length === 1) return only;
		work.decisions++;
		const signal = openingSignal(position, opening);
		if (signal) work.conditioned++;
		const sample = createHandSampler(position.view);
		const sign = isNS(position.turn) ? 1 : -1;
		const declaring = isNS(position.turn) === isNS(position.contract.declarer);
		const remaining = 13 - Math.floor(position.view.plays.length / 4);
		const reference =
			sign * scoreContract(position.contract, position.vulnerability, 9);
		const outcomes = Array.from({ length: remaining + 1 }, (_, tricks) => {
			const declarerTricks =
				position.declarerTricks + (declaring ? tricks : remaining - tricks);
			const score =
				sign *
				scoreContract(
					position.contract,
					position.vulnerability,
					declarerTricks,
				);
			return { score, utility: scoreDifferenceToImps(score - reference) };
		});
		const totals = new Map<
			number,
			{ card: Card; score: number; utility: number }
		>();
		const legal = mapLegalRankClasses(position, (card, key) => {
			let total = totals.get(key);
			if (!total) {
				total = { card, score: 0, utility: 0 };
				totals.set(key, total);
			}
			return { card, total, rank: RANKS.indexOf(rankOf(card)) };
		});
		for (let i = 0; i < SAMPLES; i++) {
			const hands = proposeLayout(sample, random, signal, work);
			work.solves++;
			const tricks = solver.solve(
				hands,
				position.contract.strain,
				position.current,
			);
			for (const total of totals.values()) {
				const n = tricks.get(total.card);
				const outcome = n === undefined ? undefined : outcomes[n];
				if (!outcome)
					throw new Error(`DDS returned invalid tricks for ${total.card}`);
				total.score += outcome.score;
				total.utility += outcome.utility;
			}
		}
		return legal.reduce((best, item) =>
			(item.total.utility - best.total.utility ||
				item.total.score - best.total.score ||
				item.rank - best.rank) > 0
				? item
				: best,
		).card;
	};
}

/** Only this table runner applies the agreement: it must control the actual opening lead. */
export function runTable(
	start: Board,
	arm: Arm,
	solver: DoubleDummySolver,
	seed: number,
	work: Work,
): number {
	const status = boardStatus(start);
	if (
		status.phase !== "play" ||
		start.cards.length !== 0 ||
		status.contract.strain !== "NT" ||
		status.contract.level !== 3
	)
		throw new Error("agreed lead study requires a full 3NT board");
	const opening =
		arm === "I" ? undefined : agreedOpener(playPosition(start, status.turn));
	const decision = createDecision(
		solver,
		work,
		arm === "D" ? opening : undefined,
	);
	let board = start;
	for (let ply = 0; ply < 52; ply++) {
		const { actor } = boardStatus(board);
		if (!actor) throw new Error(`ply ${ply}: missing actor`);
		const move = ply * 4 + SEATS.indexOf(actor);
		try {
			const card =
				ply === 0 && opening
					? opening.card
					: decision(
							playPosition(board, actor),
							random(seed ^ Math.imul(move + 1, 0x9e3779b9)),
						);
			const result = applyAction(board, actor, { type: "play", card });
			if (!result.ok) throw new Error(result.reason);
			board = result.board;
		} catch (error) {
			throw new Error(
				`ply ${ply} ${actor}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	const result = scoreBoard(board);
	if (!result?.contract) throw new Error("missing completed board score");
	return result.scoreNS;
}

function tableWork() {
	return [workCounts(), workCounts(), workCounts()] as const;
}

function runPhase(solver: DoubleDummySolver, firstSeed: number, deals: number) {
	const contrasts: (number | null)[][] = [[], [], []];
	const totals = tableWork();
	const failures: [number, number, number] = [0, 0, 0];
	for (let i = 0; i < deals; i++) {
		const seed = firstSeed + i;
		const board = makeBoard(seed, 1 + 5 * i, 0);
		const defenderSign = isNS(board.dealer) ? -1 : 1;
		const errors: Partial<Record<Arm, string>> = {};
		const work = tableWork();
		const score = ([0, 1, 2] as const).map((j) => {
			try {
				return runTable(board, ARMS[j], solver, seed, work[j]);
			} catch (error) {
				failures[j]++;
				errors[ARMS[j]] =
					error instanceof Error ? error.message : String(error);
				return null;
			} finally {
				const sum = totals[j];
				const counts = work[j];
				sum.decisions += counts.decisions;
				sum.conditioned += counts.conditioned;
				sum.proposals += counts.proposals;
				sum.solves += counts.solves;
			}
		});
		const imps = (
			[
				[1, 0],
				[2, 1],
				[2, 0],
			] as const
		).map(([a, b]) => {
			const candidate = score[a];
			const control = score[b];
			return candidate == null || control == null
				? null
				: scoreDifferenceToImps(defenderSign * (candidate - control));
		});
		imps.forEach((imp, j) => {
			contrasts[j]?.push(imp);
		});
		console.log(
			JSON.stringify({
				seed,
				board: board.number,
				score,
				imps,
				work: work.map(({ decisions, conditioned, proposals, solves }) => [
					decisions,
					conditioned,
					proposals,
					solves,
				]),
				...(Object.keys(errors).length ? { errors } : {}),
			}),
		);
	}
	const comparisons = contrasts.map((values) => {
		const scored = values.filter((imp) => imp !== null);
		const missing = deals - scored.length;
		const result = summarize(scored);
		return {
			...result,
			deals,
			missing,
			...(missing
				? { total: null, mean: null, lower95: null, signP: null }
				: {}),
		};
	});
	const pass = [comparisons[1], comparisons[2]].every(
		(r) => r && !r.missing && (r.total ?? 0) > 0 && r.wins > r.losses,
	);
	console.log(
		JSON.stringify({ firstSeed, deals, comparisons, totals, failures, pass }),
	);
	return pass;
}

if (
	process.argv[1] &&
	pathToFileURL(process.argv[1]).href === import.meta.url
) {
	const solver = await DdsSolver.create();
	const screen = runPhase(solver, 7910000, 48);
	const confirmation = screen ? runPhase(solver, 8010000, 128) : null;
	console.log(JSON.stringify({ screen, confirmation }));
}
