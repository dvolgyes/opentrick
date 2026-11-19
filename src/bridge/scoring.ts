const IMP_THRESHOLDS = [
	20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600, 750, 900, 1100, 1300,
	1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000,
];

/** Convert a signed duplicate score difference to IMPs (−24 to 24). */
export function scoreDifferenceToImps(difference: number): number {
	const absolute = Math.abs(difference);
	let magnitude = 0;
	for (const threshold of IMP_THRESHOLDS) {
		if (!(absolute >= threshold)) break;
		magnitude++;
	}
	return magnitude !== 0 && difference < 0 ? -magnitude : magnitude;
}
