import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { mixedDeal } from "../../scripts/self-play/mixed-deals";
import { runMixed } from "../../scripts/self-play/mixed-run";
import { obviousPlay } from "../../src/bot/obvious-play";
import { playPosition } from "../../src/bot/play-position";
import { applyAction, boardStatus, scoreBoard } from "../../src/bridge/engine";
import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import { SEATS } from "../../src/protocol";

const options = { dealSeed: 971, searchSeed: 2033, timeMs: 1, iterations: 1 };

it("rejects off-schedule indices, non-uint32 or reserved development seeds, and invalid limits", () => {
	for (const index of [-1, 0.5, NaN, 80])
		expect(() => runMixed(index, options)).toThrow(/index/i);
	for (const seed of [-1, 0.5, 2 ** 32, 1_720_000_000, 1_721_000_079]) {
		expect(() => runMixed(0, { ...options, dealSeed: seed })).toThrow(/seed/i);
		expect(() => runMixed(0, { ...options, searchSeed: seed })).toThrow(
			/seed/i,
		);
	}
	for (const timeMs of [0, 0.5, Infinity, 60_001])
		expect(() => runMixed(0, { ...options, timeMs })).toThrow(/time/i);
	for (const iterations of [0, 0.5, Infinity, 4097])
		expect(() => runMixed(0, { ...options, iterations })).toThrow(/iteration/i);
});

it("plays all six rooms from opening lead and scores the three direct comparisons", async () => {
	const index = 1;
	const row = await runMixed(index, options);
	const fixture = mixedDeal(index, options.dealSeed);
	const status = boardStatus(fixture);
	if (status.phase !== "play") throw new Error("fixture is not playable");
	expect(row).toMatchObject({
		index,
		seed: options.dealSeed,
		number: fixture.number,
		contract: status.contract,
		vulnerability: fixture.vulnerability,
		distribution: createHash("sha256")
			.update(
				SEATS.map((seat) => [...fixture.deal[seat]].sort().join("")).join("|"),
			)
			.digest("hex"),
	});
	expect(
		row.pairs.map(({ candidate, control }) => [candidate, control]),
	).toEqual([
		["biased", "base"],
		["biased", "plain"],
		["plain", "base"],
	]);
	for (const { candidate, control, ns, ew, imps, work } of row.pairs) {
		const empty = () => ({
			decisions: 0,
			searches: 0,
			obvious: 0,
			opening: 0,
			declarer: 0,
			defense: 0,
		});
		const replayed = { base: empty(), plain: empty(), biased: empty() };
		const rooms = [
			[ns, true],
			[ew, false],
		] as const;
		for (const [table, candidateNS] of rooms) {
			expect(table.cards).toHaveLength(52);
			let board = fixture;
			for (const card of table.cards) {
				const { actor } = boardStatus(board);
				if (!actor) throw new Error("trace ends after play has finished");
				const position = playPosition(board, actor);
				const isNS = actor === "N" || actor === "S";
				const counters = replayed[isNS === candidateNS ? candidate : control];
				counters.decisions++;
				const obvious = obviousPlay(position);
				if (obvious === undefined) {
					counters.searches++;
					if (board.cards.length === 0) counters.opening++;
					else if (actor === status.contract.declarer) counters.declarer++;
					else counters.defense++;
				} else {
					counters.obvious++;
					expect(card).toBe(obvious);
				}
				const next = applyAction(board, actor, { type: "play", card });
				if (!next.ok) throw new Error(next.reason);
				board = next.board;
			}
			expect(scoreBoard(board)).toMatchObject({
				scoreNS: table.scoreNS,
				declarerTricks: table.declarerTricks,
			});
		}
		expect(imps).toBe(scoreDifferenceToImps(ns.scoreNS - ew.scoreNS));
		expect(Object.keys(work).sort()).toEqual([candidate, control].sort());
		for (const name of [candidate, control]) {
			const stats = work[name];
			if (!stats) throw new Error(`missing ${name} work counters`);
			expect(stats).toMatchObject(replayed[name]);
			expect(stats.decisions).toBe(52);
			expect(stats.elapsedMs).toBeGreaterThanOrEqual(stats.peakMs);
			expect(stats.peakMs).toBeGreaterThan(0);
			expect(stats.ddsCalls).toBeGreaterThan(0);
			expect(stats.rootLegal).toBeGreaterThanOrEqual(stats.rootCoverage);
			expect(stats.incomplete).toBeLessThanOrEqual(stats.searches);
			expect(stats.revisits).toBe(0);
			if (name === "base") {
				expect(stats.incomplete).toBe(0);
				expect(stats.bootstrapOnly).toBe(0);
			} else {
				expect(stats.simulations + stats.bootstrapOnly).toBe(stats.searches);
			}
		}
	}
}, 15_000);
