const RESAMPLES = 10_000;

/** P(Binomial(wins + losses, 1/2) >= wins), conditional on non-ties. */
export function signP(wins: number, losses: number): number {
	if (wins === 0) return 1;
	if (losses === 0) return 2 ** -wins;
	const n = wins + losses;
	const complement = wins <= losses;
	const cutoff = complement ? wins - 1 : losses;
	let mass = 1;
	let total = 0;
	let tail = 0;
	for (let k = Math.floor(n / 2); mass > 0; --k) {
		const mirror = n - k;
		total += k === mirror ? mass : 2 * mass;
		if (k <= cutoff) tail += mass;
		mass *= k / (n - k + 1);
	}
	const probability = tail / total;
	return complement ? 1 - probability : probability;
}

function bootstrapLower(imps: readonly number[]): number | null {
	const n = imps.length;
	if (n < 2) return null;
	if (imps.every((imp) => imp === imps[0])) return imps[0] as number;
	let state = 0x51f15eed;
	const sums = new Float64Array(RESAMPLES);
	for (let trial = 0; trial < RESAMPLES; trial++) {
		let sum = 0;
		for (let draw = 0; draw < n; draw++) {
			state ^= state << 13;
			state ^= state >>> 17;
			state ^= state << 5;
			sum += imps[Math.floor(((state >>> 0) / 0x100000000) * n)] as number;
		}
		sums[trial] = sum;
	}
	sums.sort();
	return (sums[RESAMPLES / 20 - 1] as number) / n;
}

export function summarize(imps: readonly number[]) {
	let wins = 0;
	let losses = 0;
	let total = 0;
	for (const imp of imps) {
		if (!Number.isInteger(imp) || imp < -24 || imp > 24) {
			throw new RangeError("Paired-deal IMP must be an integer from -24 to 24");
		}
		if (imp > 0) wins++;
		if (imp < 0) losses++;
		total += imp;
	}
	const deals = imps.length;
	return {
		deals,
		wins,
		losses,
		ties: deals - wins - losses,
		total,
		mean: deals === 0 ? null : total / deals,
		lower95: bootstrapLower(imps),
		signP: signP(wins, losses),
	};
}
