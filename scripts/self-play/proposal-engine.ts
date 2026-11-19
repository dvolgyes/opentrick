import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import type { analyzePlay, PlayOptions } from "../../src/bot/play-engine";

export interface Work {
	proposals: number;
	dds: number;
	weightSum: number;
	mixed: number;
}

export const emptyWork = (): Work => ({
	proposals: 0,
	dds: 0,
	weightSum: 0,
	mixed: 0,
});
type Search = (
	...args: [
		Parameters<typeof analyzePlay>[0],
		Parameters<typeof analyzePlay>[1],
		PlayOptions,
		boolean,
		Work,
	]
) => ReturnType<typeof analyzePlay>;

export async function proposalEngine(): Promise<Search> {
	const source = await readFile(
		new URL("../../src/bot/play-engine.ts", import.meta.url),
		"utf8",
	);
	const parameter = "options: PlayOptions = {},";
	const loop =
		"const hands = next ? next.value : sampler(random);\n\t\tconst weight = weightLayout?.(hands) ?? 1;";
	assert.equal(source.split(parameter).length, 2);
	assert.equal(source.split(loop).length, 2);
	const code = `import { proposalCount, weightedProposal } from "../../scripts/self-play/proposal-pool";
import type { Work } from "../../scripts/self-play/proposal-engine";
${source
	.replace(parameter, `${parameter}\n\talternative: boolean,\n\twork: Work,`)
	.replace(
		loop,
		`
		let hands = next ? next.value : sampler(random);
		let weight = weightLayout?.(hands) ?? 1;
		if (alternative && !next && weightLayout && position.view.plays.length === 0) {
			const b = sampler(random);
			const c = sampler(random);
			const d = sampler(random);
			const weights = [weight, weightLayout(b), weightLayout(c), weightLayout(d)] as const;
			if (weights.some((other) => other !== weight)) work.mixed++;
			({ hands, weight } = weightedProposal([hands, b, c, d], weights, random));
			work.proposals += proposalCount;
		} else {
			work.proposals++;
		}
		work.dds++;
		work.weightSum += weight;`,
	)}`;
	const filename = new URL(
		`../../src/bot/proposal-generated-${process.pid}.ts`,
		import.meta.url,
	);
	await writeFile(filename, code, { flag: "wx" });
	return (await import(filename.href)).analyzePlay;
}
