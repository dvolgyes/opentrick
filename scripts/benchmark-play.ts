import { DdsSolver } from "../src/bot/dds-solver";
import { analyzePlay } from "../src/bot/play-engine";
import { playPosition } from "../src/bot/play-position";
import { dealCards } from "../src/bridge/deal";
import {
	applyAction,
	type Board,
	boardStatus,
	createBoard,
	legalActions,
} from "../src/bridge/engine";
import type { Call } from "../src/bridge/rules";

// Frozen evaluation protocol: six independent deals, four positions per deal.
// Oracle trick loss is a perfect-information diagnostic, not a tournament-strength rating.
const mixed = process.argv.includes("--mixed");
const SEEDS = mixed
	? [981173, 177331, 672103, 410299, 801193, 261773, 590111, 371077]
	: [20261027, 693107, 881923, 190081, 371213, 510613];
const PLY = mixed ? [0, 8, 24, 40] : [1, 9, 25, 41];
function random(seed: number): () => number {
	let state = seed;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

function act(board: Board, call: Call): Board {
	const actor = boardStatus(board).actor;
	if (!actor) throw new Error("missing bidder");
	const result = applyAction(board, actor, { type: "call", call });
	if (!result.ok) throw new Error(result.reason);
	return result.board;
}

const solver = await DdsSolver.create();
const rows: Record<string, string | number | null>[] = [];
for (const [index, seed] of SEEDS.entries()) {
	const rng = random(seed);
	let board = createBoard(
		index + 1,
		dealCards((bound) => Math.floor(rng() * bound)),
	);
	const contract: Call = mixed
		? ((["4S", "4H", "5D", "5C", "3NT"] as const)[index % 5] ?? "3NT")
		: "3NT";
	for (const call of [contract, "P", "P", "P"] as const)
		board = act(board, call);
	for (let ply = 0; ply <= 41; ply++) {
		const status = boardStatus(board);
		if (status.phase !== "play")
			throw new Error("board ended before its evaluation positions");
		const legal = legalActions(board, status.actor);
		if (PLY.includes(ply)) {
			const position = playPosition(board, status.actor);
			const engine = analyzePlay(position, solver, {
				random: random(seed ^ ply ^ 0xa5a5),
			});
			const oracle = solver.solve(
				status.remaining,
				status.contract.strain,
				status.current,
			);
			const best = Math.max(...oracle.values());
			const engineTricks = oracle.get(engine.card);
			if (engineTricks === undefined)
				throw new Error("engine card missing from oracle");
			const row = {
				seed,
				ply,
				contract,
				actor: status.actor,
				turn: status.turn,
				engineCard: engine.card,
				engineLoss: best - engineTricks,
				engineMs: engine.elapsedMs,
				samples: engine.samples,
				effectiveSamples: engine.effectiveSamples,
			};
			rows.push(row);
			console.log(JSON.stringify({ type: "position", ...row }));
		}
		const action = legal[Math.floor(rng() * legal.length)];
		if (!action) throw new Error("missing legal continuation");
		const result = applyAction(board, status.actor, action);
		if (!result.ok) throw new Error(result.reason);
		board = result.board;
	}
}
const values = (key: string) =>
	rows.flatMap((row) =>
		typeof row[key] === "number" ? [row[key] as number] : [],
	);
const mean = (items: number[]) =>
	items.length ? items.reduce((a, b) => a + b, 0) / items.length : null;
console.log(
	JSON.stringify({
		type: "summary",
		protocol: `${SEEDS.length} deals, four fixed random-play positions each; ${mixed ? "mixed strains and opening leads" : "no trump"}; DD trick regret; all rows reported`,
		positions: rows.length,
		engineMeanLoss: mean(values("engineLoss")),
		engineMeanMs: mean(values("engineMs")),
		engineMaxMs: Math.max(...values("engineMs")),
		enginePerfectChoices: values("engineLoss").filter((loss) => loss === 0)
			.length,
	}),
);
