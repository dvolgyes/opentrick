import { parseArgs } from "node:util";
import { DdsSolver } from "../src/bot/dds-solver";
import { parseBoard } from "../src/bridge/engine";
import { makeBoard, playPair, random } from "./self-play/arena";
import { cardingPolicy } from "./self-play/carding";
import { policy } from "./self-play/policy";
import { summarize } from "./self-play/statistics";

const { values } = parseArgs({
	options: {
		candidate: { type: "string", default: "incumbent" },
		deals: { type: "string" },
		seed: { type: "string" },
		"search-seed": { type: "string" },
		ply: { type: "string" },
		samples: { type: "string" },
		"time-ms": { type: "string" },
		board: { type: "string" },
		help: { type: "boolean" },
	},
});
if (values.help) {
	console.log(`Play each board twice with the candidate partnerships swapped. Output: JSON Lines.
  --candidate incumbent|cash|contract|carding  Policy to compare with the incumbent (default: incumbent)
  --deals N --seed N --ply N           Generated boards, first deal seed, prefix length (defaults: 1, 310700, 0)
  --board JSON                        One unfinished board with a completed auction, including any played prefix
  --search-seed N                     Search randomness, separate from deal generation (default: 129723)
  --samples N | --time-ms N           Layouts per decision (default: 6) or soft core time budget`);
	process.exit(0);
}
function integer(
	value: string | undefined,
	fallback: number,
	min: number,
	max: number,
	name: string,
): number {
	if (value === undefined) return fallback;
	const n = Number(value);
	if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max)
		throw new Error(`${name} must be an integer from ${min} to ${max}`);
	return n;
}
const ranking = values.candidate;
if (
	ranking !== "incumbent" &&
	ranking !== "cash" &&
	ranking !== "contract" &&
	ranking !== "carding"
)
	throw new Error(
		"Unknown candidate; use incumbent, cash, contract or carding",
	);
if (values.samples !== undefined && values["time-ms"] !== undefined)
	throw new Error("Choose a sample budget or a time budget, not both");
if (
	values.board !== undefined &&
	[values.seed, values.deals, values.ply].some((v) => v !== undefined)
)
	throw new Error("--board replaces --deals, --seed and --ply");
const deals = integer(values.deals, 1, 1, 10_000, "deals");
const seed = integer(values.seed, 310700, 0, 2 ** 32 - deals, "seed");
const searchSeed = integer(
	values["search-seed"],
	129723,
	0,
	2 ** 32 - 1,
	"search-seed",
);
const ply = integer(values.ply, 0, 0, 51, "ply");
const budget =
	values["time-ms"] === undefined
		? { samples: integer(values.samples, 6, 1, 4096, "samples") }
		: { timeMs: integer(values["time-ms"], 5000, 1, 60_000, "time-ms") };
function suppliedBoard(json: string) {
	if (json.length > 16_384)
		throw new Error("Board JSON exceeds 16384 characters");
	const board = parseBoard(JSON.parse(json));
	if (!board)
		throw new Error("Invalid board; supply a legal OpenTrick Board as JSON");
	return board;
}
const supplied =
	values.board === undefined ? undefined : suppliedBoard(values.board);
const emit = (record: unknown) => console.log(JSON.stringify(record));
emit({
	type: "protocol",
	version: 1,
	candidate: ranking,
	baseline: "incumbent",
	runtime: process.version,
	deals,
	seed: supplied ? null : seed,
	ply: supplied?.cards.length ?? ply,
	searchSeed,
	budget,
});
const solver = await DdsSolver.create();
const incumbent = policy("incumbent", solver, budget);
const challenger =
	ranking === "carding"
		? cardingPolicy(solver, budget, supplied?.cards.length ?? ply)
		: policy(ranking, solver, budget);
const rng = random(searchSeed);
const imps: number[] = [];
for (let i = 0; i < deals; i++) {
	const board = supplied ?? makeBoard(seed + i, i + 1, ply);
	const pairSeed = Math.floor(rng() * 2 ** 32);
	const pair = playPair(board, incumbent, challenger, pairSeed);
	imps.push(pair.imps);
	emit({ type: "pair", board, searchSeed: pairSeed, ...pair });
}
emit({ type: "summary", candidate: ranking, ...summarize(imps) });
