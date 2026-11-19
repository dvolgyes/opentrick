import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { boardStatus, parseBoard, scoreBoard } from "../../src/bridge/engine";
import { STRAINS } from "../../src/bridge/rules";
import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import { SEATS } from "../../src/protocol";
import { random } from "./arena";
import { mixedDeal } from "./mixed-deals";
import type { MixedRow } from "./mixed-run";
import { signP } from "./statistics";

const boards = 80;
const contrasts = ["plain-base", "biased-base", "biased-plain"] as const;
const policies = ["base", "plain", "biased"] as const;
type Policy = (typeof policies)[number];

/** Resample deals within strain, in the frozen board order. */
export function mixedReturns(imps: readonly number[]) {
	assert.equal(imps.length, boards);
	const strain = { C: 0, D: 0, H: 0, S: 0, NT: 0 };
	const group = { low: 0, game: 0, small: 0, grand: 0 };
	let wins = 0,
		losses = 0,
		total = 0;
	for (const [i, imp] of imps.entries()) {
		assert(Number.isInteger(imp) && Math.abs(imp) <= 24);
		const suit = STRAINS[i % 5];
		assert(suit);
		strain[suit] += imp;
		group[i < 40 ? "low" : i < 70 ? "game" : i < 75 ? "small" : "grand"] += imp;
		wins += Number(imp > 0);
		losses += Number(imp < 0);
		total += imp;
	}
	const samples = new Int16Array(20_000);
	const rng = random(0x42524944);
	for (let n = 0; n < samples.length; n++) {
		let sum = 0;
		for (let s = 0; s < 5; s++)
			for (let j = 0; j < 16; j++)
				sum += imps[s + 5 * Math.floor(16 * rng())] as number;
		samples[n] = sum;
	}
	const lower = (samples.sort()[333] as number) / boards;
	const p = signP(wins, losses);
	return {
		total,
		mean: total / boards,
		wins,
		losses,
		ties: boards - wins - losses,
		lower,
		signP: p,
		qualifies: wins + losses >= 20 && lower > 0.1 && p < 0.05 / 3,
		strain,
		group,
	};
}

function workTotals() {
	return {
		decisions: 0,
		obvious: 0,
		searches: 0,
		opening: 0,
		defense: 0,
		declarer: 0,
		elapsedMs: 0,
		peakMs: 0,
		ddsCalls: 0,
		simulations: 0,
		rootCoverage: 0,
		rootLegal: 0,
		incomplete: 0,
		bootstrapOnly: 0,
		revisits: 0,
	};
}

/** Regenerate scheduled deals, replay every room, then evaluate all three direct matches. */
export function mixedReport(jsonl: string) {
	const lines = jsonl.trimEnd().split("\n");
	assert.equal(lines.length, boards, "expected 80 scheduled boards");
	const values = new Map<string, number[]>(contrasts.map((c) => [c, []]));
	const work = {
		base: workTotals(),
		plain: workTotals(),
		biased: workTotals(),
	};
	const hands = new Set<string>();
	for (const [i, line] of lines.entries()) {
		const row: MixedRow = JSON.parse(line);
		assert.equal(row.index, i);
		assert.equal(row.seed, 1_720_000_000 + i);
		const board = mixedDeal(i, row.seed);
		assert.equal(row.number, board.number);
		assert.equal(row.vulnerability, board.vulnerability);
		assert.deepEqual(row.contract, boardStatus(board).contract);
		assert.equal(row.contract.strain, STRAINS[i % 5]);
		const id = createHash("sha256")
			.update(SEATS.map((s) => [...board.deal[s]].sort().join("")).join("|"))
			.digest("hex");
		assert.equal(row.distribution, id);
		assert(!hands.has(id));
		hands.add(id);
		assert.equal(row.pairs.length, contrasts.length);
		for (const pair of row.pairs) {
			const vs = `${pair.candidate}-${pair.control}`;
			const ds = values.get(vs);
			assert(
				ds && ds.length === i,
				`missing, unexpected or duplicate pair ${i}/${vs}`,
			);
			for (const table of [pair.ns, pair.ew]) {
				assert.equal(table.cards.length, 52);
				const played = parseBoard({ ...board, cards: table.cards });
				assert(played, `illegal play ${i}/${vs}`);
				const actual = scoreBoard(played);
				assert(actual);
				assert.equal(table.declarerTricks, actual.declarerTricks);
				assert.equal(table.scoreNS, actual.scoreNS);
			}
			for (const name of [pair.candidate, pair.control] as Policy[]) {
				const w = pair.work[name];
				assert(w);
				assert.equal(w.decisions, 52);
				assert.equal(w.obvious + w.searches, 52);
				assert.equal(w.opening + w.defense + w.declarer, w.searches);
				assert(
					w.bootstrapOnly <= w.incomplete &&
						w.incomplete <= w.searches &&
						w.rootCoverage <= w.rootLegal,
				);
				for (const field of Object.keys(work[name]) as (keyof ReturnType<
					typeof workTotals
				>)[]) {
					const n = w[field];
					assert(Number.isFinite(n) && n >= 0);
					if (field === "peakMs")
						work[name].peakMs = Math.max(work[name].peakMs, n);
					else work[name][field] += n;
				}
			}
			const imp = scoreDifferenceToImps(pair.ns.scoreNS - pair.ew.scoreNS);
			assert.equal(pair.imps, imp);
			ds.push(imp);
		}
	}
	const results = Object.fromEntries(
		[...values].map(([key, imps]) => [key, mixedReturns(imps)]),
	);
	const nominated =
		results["biased-base"]?.qualifies && results["biased-plain"]?.qualifies
			? "biased"
			: results["plain-base"]?.qualifies
				? "plain"
				: null;
	return {
		boards,
		tables: boards * 6,
		plays: boards * 6 * 52,
		results,
		work,
		nominated,
	};
}

if (
	process.argv[1] &&
	pathToFileURL(process.argv[1]).href === import.meta.url
) {
	assert(
		process.argv.length === 3 && process.argv[2],
		"usage: mixed-score.ts <canonical JSONL>",
	);
	console.log(
		JSON.stringify(
			mixedReport(await readFile(process.argv[2], "utf8")),
			null,
			2,
		),
	);
}
