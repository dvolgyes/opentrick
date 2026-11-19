import assert from "node:assert/strict";
import { type PlayPosition, playPosition } from "../../src/bot/play-position";
import { boardStatus } from "../../src/bridge/engine";
import { makeBoard } from "./arena";
import { assignments, layoutKey } from "./ending-oracle";

const BASELINE = 256;
const CANDIDATE = 512;
const MIN_PLY = 28;
const ORACLE = { base: 11_700_000, count: 32, warm: 4 };
const PAIRED = { base: 11_800_000, count: 64, warm: 0 };
const SCANS = 1200;
const BUDGET = 5000;
const GUARD = 60000;
const CEILING = 1000;
const TOLERANCE = 1e-10;

function boundedPopulation(position: PlayPosition) {
	let count = 0;
	for (const _ of assignments(position.view)) {
		if (++count > CANDIDATE) break;
	}
	return count;
}

function preflight({ base, count, warm }: typeof ORACLE, dealt: Set<string>) {
	const scanned = [];
	const selected: number[] = [];
	for (let i = 0; i < SCANS; i++) {
		const seed = base + i;
		const number = i + 1;
		const ply = MIN_PLY + ((Math.floor(i / 5) + (i % 5)) % 4);
		const board = makeBoard(seed, number, ply);
		const actor = boardStatus(board).actor;
		assert.ok(actor);
		const position = playPosition(board, actor);
		assert.equal(position.hints.length, 0);
		const legal = position.legal.length;
		const population = legal > 1 ? boundedPopulation(position) : 0;
		const dealKey = layoutKey(board.deal);
		let status: string;
		if (legal === 1) status = "forced";
		else if (population <= BASELINE) status = "at-or-below-incumbent";
		else if (population > CANDIDATE) status = "above-candidate";
		else if (dealt.has(dealKey)) status = "duplicate-deal";
		else if (selected.length >= count + warm) status = "reserve";
		else if (selected.length >= count) status = "warm";
		else status = "selected";
		const trial = {
			seed,
			number,
			ply,
			legal,
			population,
			status,
			strain: position.contract.strain,
		};
		scanned.push(trial);
		if (status === "selected" || status === "warm") {
			dealt.add(dealKey);
			selected.push(population);
		}
	}
	const distinctPopulations = [...new Set(selected.slice(0, count))].sort(
		(a, b) => a - b,
	);
	const passed =
		selected.length === count + warm && distinctPopulations.length >= 2;
	return { scanned, distinctPopulations, passed };
}

const dealt = new Set<string>();
for (const cohort of [ORACLE, PAIRED]) {
	const { scanned, distinctPopulations, passed } = preflight(cohort, dealt);
	console.log(
		JSON.stringify({
			type: "preflight",
			cohort,
			scans: SCANS,
			minPly: MIN_PLY,
			baseline: BASELINE,
			candidate: CANDIDATE,
			budgetMs: BUDGET,
			workGuardMs: GUARD,
			ceilingMs: CEILING,
			tolerance: TOLERANCE,
			node: process.version,
			arch: process.arch,
			platform: process.platform,
			passed,
			distinctPopulations,
			scanned,
		}),
	);
	if (!passed) process.exitCode = 1;
}
