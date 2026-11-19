export const proposalCount = 4;

export function weightedProposal<T>(
	proposals: readonly [T, T, T, T],
	weights: readonly [number, number, number, number],
	random: () => number,
): { hands: T; weight: number } {
	const [a, b, c, d] = weights;
	if (a === b && a === c && a === d) return { hands: proposals[0], weight: a };
	const ab = a + b;
	const abc = ab + c;
	const sum = abc + d;
	const at = random() * sum;
	const selected = at < a ? 0 : at < ab ? 1 : at < abc ? 2 : 3;
	return { hands: proposals[selected], weight: sum / proposalCount };
}
