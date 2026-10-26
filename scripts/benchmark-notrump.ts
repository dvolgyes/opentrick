import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { DdsSolver } from "../src/bot/dds-solver";
import type { PlayAnalysis } from "../src/bot/play-engine";
import { type Card, SUITS, suitOf } from "../src/bridge/cards";
import { dealCards, randomBelowFrom } from "../src/bridge/deal";
import {
	applyAction,
	type Board,
	boardStatus,
	createBoard,
} from "../src/bridge/engine";
import { countHandPoints } from "../src/bridge/hand-points";
import type { Call } from "../src/bridge/rules";

// Fixed before play: four distinct deals at each total, selected only by HCP and a natural 1NT opener.
// No selection on stoppers, suit fit, double-dummy makeability, or observed results.
const PER_TOTAL = 4;
const ORIGIN = "http://127.0.0.1:5181";

interface TestDeal {
	readonly id: string;
	readonly seed: number;
	readonly draw: number;
	readonly hcp: number;
	readonly northHcp: number;
	readonly southHcp: number;
	readonly board: Board;
}

interface Move {
	readonly ply: number;
	readonly card: Card;
	readonly samples: number;
	readonly effectiveSamples: number;
	readonly wallMs: number;
}

function testDeals(): TestDeal[] {
	const result: TestDeal[] = [];
	for (const hcp of [25, 26, 27]) {
		const seed = 20261000 + hcp;
		let state = seed;
		const randomBelow = randomBelowFrom(() => {
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			return state;
		});
		let accepted = 0;
		for (let draw = 1; accepted < PER_TOTAL && draw <= 100_000; draw++) {
			const deal = dealCards(randomBelow);
			const northHcp = countHandPoints("hcp", deal.N).total;
			const southHcp = countHandPoints("hcp", deal.S).total;
			const shape = SUITS.map(
				(suit) => deal.N.filter((card) => suitOf(card) === suit).length,
			)
				.toSorted((a, b) => b - a)
				.join("");
			if (
				northHcp + southHcp !== hcp ||
				northHcp < 15 ||
				northHcp > 17 ||
				!["4333", "4432", "5332"].includes(shape)
			)
				continue;
			let board = createBoard(1, deal);
			const auction: readonly Call[] =
				southHcp >= 10
					? ["1NT", "P", "3NT", "P", "P", "P"]
					: ["1NT", "P", "2NT", "P", "3NT", "P", "P", "P"];
			for (const call of auction) {
				const actor = boardStatus(board).actor;
				if (!actor) throw new Error("missing bidder");
				const action = applyAction(board, actor, { type: "call", call });
				if (!action.ok) throw new Error(action.reason);
				board = action.board;
			}
			accepted++;
			result.push({
				id: `${hcp}-${accepted}`,
				seed,
				draw,
				hcp,
				northHcp,
				southHcp,
				board,
			});
		}
		if (accepted !== PER_TOTAL)
			throw new Error(`not enough eligible ${hcp}-HCP deals`);
	}
	return result;
}

const deals = testDeals();
const oracle = await DdsSolver.create();
const server = await createServer({
	server: { host: "127.0.0.1", port: 5181, strictPort: true },
	logLevel: "error",
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: {
	hcp: number;
	tricks: number;
	ddTricks: number;
	declarerLoss: number;
	defenderLoss: number;
}[] = [];
try {
	const page = await browser.newPage();
	let modelRequests = 0;
	await page.route("https://openrouter.ai/**", async (route) => {
		modelRequests++;
		await route.abort();
	});
	await page.goto(ORIGIN);
	console.log(
		JSON.stringify({
			type: "protocol",
			deals: 12,
			perHcp: PER_TOTAL,
			totals: [25, 26, 27],
			opener: "North, balanced 15–17 HCP",
			policy:
				"production BrowserPlayEngine on all seats; defaults unchanged; public auction hints enabled",
			seeds: [20261025, 20261026, 20261027],
			selection: "first four qualifying deals per seed; no DD filtering",
			oracle: "perfect information, best defense from the opening lead",
			runtime: process.version,
		}),
	);
	for (const deal of deals) {
		const initial = boardStatus(deal.board);
		if (initial.phase !== "play") throw new Error("not a play position");
		const ddTricks =
			13 -
			Math.max(
				...oracle.solve(initial.remaining, "NT", initial.current).values(),
			);
		const moves = await page.evaluate(
			async (initialBoard: Board): Promise<Move[]> => {
				const browserPath = "/src/bot/browser-play.ts";
				const positionPath = "/src/bot/play-position.ts";
				const gamePath = "/src/bridge/engine.ts";
				const { BrowserPlayEngine } = (await import(
					browserPath
				)) as typeof import("../src/bot/browser-play");
				const { playPosition } = (await import(
					positionPath
				)) as typeof import("../src/bot/play-position");
				const { boardStatus, applyAction } = (await import(
					gamePath
				)) as typeof import("../src/bridge/engine");
				const engine = new BrowserPlayEngine();
				const signal = new AbortController().signal;
				const moves: Move[] = [];
				let board = initialBoard;
				try {
					for (let ply = 0; ply < 52; ply++) {
						const status = boardStatus(board);
						if (status.phase !== "play") throw new Error("board ended early");
						const position = playPosition(board, status.actor, {
							N: "hcp",
							E: "hcp",
							S: "hcp",
							W: "hcp",
						});
						const started = performance.now();
						const analysis: PlayAnalysis = await engine.choose(
							position,
							signal,
						);
						moves.push({
							ply,
							card: analysis.card,
							samples: analysis.samples,
							effectiveSamples: analysis.effectiveSamples,
							wallMs: performance.now() - started,
						});
						const applied = applyAction(board, status.actor, {
							type: "play",
							card: analysis.card,
						});
						if (!applied.ok) throw new Error(applied.reason);
						board = applied.board;
					}
					if (
						boardStatus(board).phase !== "complete" ||
						new Set(board.cards).size !== 52
					)
						throw new Error("invalid final board");
					return moves;
				} finally {
					engine.stop();
				}
			},
			deal.board,
		);
		let replay = deal.board;
		let declarerLoss = 0;
		let defenderLoss = 0;
		for (const move of moves) {
			const status = boardStatus(replay);
			if (status.phase !== "play") throw new Error("replay ended early");
			const scores = oracle.solve(status.remaining, "NT", status.current);
			const achieved = scores.get(move.card);
			if (achieved === undefined)
				throw new Error("played card missing from oracle");
			const loss = Math.max(...scores.values()) - achieved;
			if (status.turn === "N" || status.turn === "S") declarerLoss += loss;
			else defenderLoss += loss;
			const applied = applyAction(replay, status.actor, {
				type: "play",
				card: move.card,
			});
			if (!applied.ok) throw new Error(applied.reason);
			replay = applied.board;
		}
		const end = boardStatus(replay);
		if (end.phase !== "complete" || end.tricksNS + end.tricksEW !== 13)
			throw new Error("invalid trick count");
		const result = {
			hcp: deal.hcp,
			tricks: end.tricksNS,
			ddTricks,
			declarerLoss,
			defenderLoss,
		};
		if (ddTricks + defenderLoss - declarerLoss !== result.tricks)
			throw new Error(
				"oracle losses do not reconcile with the final trick count",
			);
		results.push(result);
		console.log(
			JSON.stringify({
				type: "board",
				...deal,
				...result,
				made: result.tricks >= 9,
				ddMakeable: ddTricks >= 9,
				moves,
			}),
		);
		console.error(
			`${deal.id}: ${deal.hcp} HCP; 3NT took ${result.tricks}, DD ${ddTricks}; declarer lost ${declarerLoss}, defenders lost ${defenderLoss}`,
		);
	}
	if (modelRequests !== 0)
		throw new Error("local play attempted an OpenRouter request");
	console.log(
		JSON.stringify({
			type: "summary",
			boards: results.length,
			modelRequests,
			groups: [25, 26, 27].map((hcp) => {
				const group = results.filter((result) => result.hcp === hcp);
				return {
					hcp,
					boards: group.length,
					made: group.filter((result) => result.tricks >= 9).length,
					ddMakeable: group.filter((result) => result.ddTricks >= 9).length,
					madeWhenDdMakeable: group.filter(
						(result) => result.ddTricks >= 9 && result.tricks >= 9,
					).length,
					tricks: group.map((result) => result.tricks),
					ddTricks: group.map((result) => result.ddTricks),
					declarerTricksLost: group.reduce(
						(sum, result) => sum + result.declarerLoss,
						0,
					),
					defenderTricksLost: group.reduce(
						(sum, result) => sum + result.defenderLoss,
						0,
					),
				};
			}),
		}),
	);
} finally {
	await browser.close();
	await server.close();
}
