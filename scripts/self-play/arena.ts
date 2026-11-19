import { type PlayPosition, playPosition } from "../../src/bot/play-position";
import type { Card } from "../../src/bridge/cards";
import { dealCards, randomBelowFrom } from "../../src/bridge/deal";
import {
	type Action,
	applyAction,
	type Board,
	boardStatus,
	createBoard,
	legalActions,
	parseBoard,
	scoreBoard,
} from "../../src/bridge/engine";
import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import { SEATS, type Seat } from "../../src/protocol";

export type PlayPolicy = (position: PlayPosition, random: () => number) => Card;

export interface PlayedTable {
	readonly scoreNS: number;
	readonly declarerTricks: number;
	readonly cards: readonly Card[];
}

export interface PlayPairResult {
	readonly candidateNS: PlayedTable;
	readonly candidateEW: PlayedTable;
	readonly imps: number;
}

const CONTRACTS = ["3NT", "4S", "4H", "5D", "5C"] as const;

/** SplitMix32: advance a 32-bit counter and avalanche its bits before use. */
export function random(seed: number): () => number {
	if (!Number.isSafeInteger(seed)) throw new Error(`invalid seed: ${seed}`);
	let state = seed >>> 0;
	return () => {
		state = (state + 0x9e3779b9) >>> 0;
		let x = Math.imul(state ^ (state >>> 16), 0x21f0aaad);
		x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
		return ((x ^ (x >>> 15)) >>> 0) / 2 ** 32;
	};
}

function act(board: Board, actor: Seat, action: Action): Board {
	const result = applyAction(board, actor, action);
	if (!result.ok)
		throw new Error(
			`board ${board.number}, ply ${board.cards.length}, ${actor}: ${result.reason}`,
		);
	return result.board;
}

export function makeBoard(seed: number, number: number, ply: number): Board {
	if (!Number.isInteger(ply) || ply < 0 || ply >= 52)
		throw new Error(`starting ply must be an integer from 0 to 51: ${ply}`);
	const rng = random(seed);
	const below = randomBelowFrom(() => rng() * 2 ** 32);
	let board = createBoard(number, dealCards(below));
	const bid = CONTRACTS[(number - 1) % CONTRACTS.length];
	if (!bid) throw new Error(`missing contract for board ${number}`);
	for (const call of [bid, "P", "P", "P"] as const) {
		const actor = boardStatus(board).actor;
		if (!actor) throw new Error("no bidder");
		board = act(board, actor, { type: "call", call });
	}
	while (board.cards.length < ply) {
		const { actor } = boardStatus(board);
		if (!actor) throw new Error("board ended during prefix");
		const legal = legalActions(board, actor);
		const action = legal[below(legal.length)];
		if (!action) throw new Error("no legal prefix action");
		board = act(board, actor, action);
	}
	return board;
}

/** Complete one table from a validated play position using the arena's per-position streams. */
export function playTable(
	board: Board,
	ns: PlayPolicy,
	ew: PlayPolicy,
	seed: number,
): PlayedTable {
	while (board.cards.length < 52) {
		const { actor } = boardStatus(board);
		if (!actor) throw new Error("board ended early");
		const position = playPosition(board, actor);
		const policy = actor === "N" || actor === "S" ? ns : ew;
		const move = board.cards.length * 4 + SEATS.indexOf(actor);
		const card = policy(
			position,
			random(seed ^ Math.imul(move + 1, 0x9e3779b9)),
		);
		board = act(board, actor, { type: "play", card });
	}
	const result = scoreBoard(board);
	if (!result?.contract) throw new Error("no completed contract");
	return {
		scoreNS: result.scoreNS,
		declarerTricks: result.declarerTricks,
		cards: board.cards,
	};
}

export function playPair(
	board: Board,
	baseline: PlayPolicy,
	candidate: PlayPolicy,
	searchSeed: number,
): PlayPairResult {
	if (!Number.isSafeInteger(searchSeed))
		throw new Error(`invalid search seed: ${searchSeed}`);
	const start = parseBoard(board);
	if (!start || boardStatus(start).phase !== "play")
		throw new Error("paired play requires a legal unfinished play position");
	const candidateNS = playTable(start, candidate, baseline, searchSeed);
	const candidateEW = playTable(start, baseline, candidate, searchSeed);
	const difference = candidateNS.scoreNS - candidateEW.scoreNS;
	return { candidateNS, candidateEW, imps: scoreDifferenceToImps(difference) };
}
