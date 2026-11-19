import { DdsSolver } from "../src/bot/dds-solver";
import type { PlayPosition } from "../src/bot/play-position";
import { makeBoard, playPair } from "./self-play/arena";
import { competitiveDeal } from "./self-play/competitive-deals";
import { type Advice, boardSearch } from "./self-play/defensive-search";
import { partnerOpening } from "./self-play/partner-opening";
import { secondSeat } from "./self-play/second-seat";
import { summarize } from "./self-play/statistics";
import { trumpOpening } from "./self-play/trump-opening";

const families = {
	second: 8_400_000,
	partner: 8_600_000,
	trump: 8_800_000,
} as const;
type Family = keyof typeof families;
function treatments(family: Family): ReadonlyMap<string, Advice> {
	switch (family) {
		case "second":
			return new Map([
				["low", (p, c) => secondSeat("low", p, c)],
				["context", (p, c) => secondSeat("context", p, c)],
			]);
		case "partner":
			return new Map([
				["high", (p, c) => partnerOpening("high", p, c)],
				["standard", (p, c) => partnerOpening("standard", p, c)],
			]);
		case "trump":
			return new Map([
				["fourth", (p, c) => trumpOpening("fourth", p, c)],
				["short", (p, c) => trumpOpening("short", p, c)],
			]);
	}
}

const [family, phase] = process.argv.slice(2);
if (
	(family !== "second" && family !== "partner" && family !== "trump") ||
	(phase !== "screen" && phase !== "holdout") ||
	process.argv.length !== 4
)
	throw new Error(
		"Usage: node --import tsx scripts/defensive-study.ts second|partner|trump screen|holdout",
	);
const samples = phase === "screen" ? 4 : 8;
const deals = phase === "screen" ? 40 : 96;
const first = families[family] + (phase === "screen" ? 0 : 100_000);
const arms = Array.from(treatments(family), ([name, advice]) => ({
	name,
	advice,
	imps: [] as number[],
}));
const solver = await DdsSolver.create();
for (let i = 0; i < deals; i++) {
	const seed = first + i;
	const number = family === "trump" ? 2 + i + Math.floor(i / 4) : i + 1;
	const fixture =
		family === "partner"
			? competitiveDeal(seed, number)
			: {
					board: makeBoard(seed, number, 0),
					hints: [] as PlayPosition["hints"],
					draws: 1,
				};
	const search = boardSearch(solver, samples, fixture.hints);
	const trials = arms.map((arm) => {
		const incumbent = search.policy();
		const candidate = search.policy(arm.advice);
		const { candidateNS, candidateEW, imps } = playPair(
			fixture.board,
			incumbent.play,
			candidate.play,
			seed ^ 0x3d81ab2c,
		);
		arm.imps.push(imps);
		return {
			arm: arm.name,
			ns: candidateNS.scoreNS,
			ew: candidateEW.scoreNS,
			imps,
			candidate: candidate.counts,
			incumbentLayouts: incumbent.counts.layouts,
		};
	});
	console.log(
		JSON.stringify({
			family,
			phase,
			seed,
			number,
			draws: fixture.draws,
			samples,
			trials,
			work: search.work,
		}),
	);
}
console.log(
	JSON.stringify({
		family,
		phase,
		first,
		samples,
		results: arms.map(({ name, imps }) => ({ arm: name, ...summarize(imps) })),
	}),
);
