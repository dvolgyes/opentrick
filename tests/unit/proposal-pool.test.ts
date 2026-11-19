import assert from "node:assert/strict";
import { test } from "vitest";
import { weightedProposal } from "../../scripts/self-play/proposal-pool";

const close = (actual: number, expected: number) =>
	assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test("four-proposal weighting matches ordinary importance totals, not a double-weighted oracle", () => {
	let numerator = 0;
	let denominator = 0;
	let wrongNumerator = 0;
	let wrongDenominator = 0;
	let oneUnitRatio = 0;
	const indices = [0, 1, 2, 3] as const;
	for (let mask = 0; mask < 16; mask++) {
		const weights = indices.map((i) => (((mask >> i) & 1) === 0 ? 1 : 3)) as [
			number,
			number,
			number,
			number,
		];
		const sum = weights.reduce((a, b) => a + b);
		let prefix = 0;
		for (const index of indices) {
			const rawWeight = weights[index];
			const probability = rawWeight / sum / 16;
			const result = weightedProposal(
				indices,
				weights,
				() => (prefix + rawWeight / 2) / sum,
			);
			prefix += rawWeight;
			if (mask !== 0 && mask !== 15) assert.equal(result.hands, index);
			const selectedWeight = weights[result.hands];
			const utility = selectedWeight - 1;
			numerator += probability * result.weight * utility;
			denominator += probability * result.weight;
			wrongNumerator += probability * result.weight * selectedWeight * utility;
			wrongDenominator += probability * result.weight * selectedWeight;
			oneUnitRatio += probability * utility;
		}
	}
	close(numerator, 3);
	close(denominator, 2);
	close(numerator / denominator, 1.5);
	close(wrongNumerator, 9);
	close(wrongDenominator, 5);
	close(wrongNumerator / wrongDenominator, 1.8);
	close(oneUnitRatio, 1.3875);
});

test("an equal-weight pool preserves its first sample and does not consume a draw", () => {
	const uniform = weightedProposal(["a", "b", "c", "d"], [1, 1, 1, 1], () => {
		assert.fail("equal weights should not use the selection RNG");
	});
	assert.deepEqual(uniform, { hands: "a", weight: 1 });
});
