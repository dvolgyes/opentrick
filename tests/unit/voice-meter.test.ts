import { describe, expect, it } from "vitest";
import {
	litSegments,
	nextShownLevel,
	voiceLevel,
} from "../../src/ui/voice-meter";

/** A block of samples with this RMS amplitude. */
function block(rms: number): Float32Array {
	return Float32Array.from({ length: 256 }, (_, index) =>
		index % 2 === 0 ? rms : -rms,
	);
}

describe("voice level", () => {
	it("is 0 for silence, 1 for a loud voice, and rises with the decibels between", () => {
		expect(voiceLevel(new Float32Array(256))).toBe(0);
		expect(voiceLevel(new Float32Array(0))).toBe(0);
		// Room noise, -60 dBFS, stays dark.
		expect(voiceLevel(block(0.001))).toBe(0);
		// -35 dBFS is halfway between the floor (-55) and the ceiling (-15).
		expect(voiceLevel(block(10 ** (-35 / 20)))).toBeCloseTo(0.5, 5);
		expect(voiceLevel(block(0.5))).toBe(1);
		expect(voiceLevel(block(0.01))).toBeLessThan(voiceLevel(block(0.03)));
	});
});

describe("shown level", () => {
	it("rises at once and sinks gradually, by the time that passed", () => {
		expect(nextShownLevel(0.2, 0.9, 16)).toBe(0.9);
		const falling = nextShownLevel(0.9, 0, 16);
		expect(falling).toBeLessThan(0.9);
		expect(falling).toBeGreaterThan(0.5);
		// A faster screen draws more frames, but the bars sink at the same speed.
		let fast = 1;
		for (let frame = 0; frame < 144; frame++)
			fast = nextShownLevel(fast, 0, 1000 / 144);
		let slow = 1;
		for (let frame = 0; frame < 60; frame++)
			slow = nextShownLevel(slow, 0, 1000 / 60);
		expect(fast).toBeCloseTo(slow, 10);
		// After one second of silence the box is dark.
		expect(slow).toBeLessThan(0.02);
	});
});

describe("lit segments", () => {
	const lit = (flags: readonly boolean[]) =>
		flags.map((flag) => (flag ? "#" : ".")).join("");

	it("lights a column from its middle outwards, symmetrically", () => {
		expect(lit(litSegments(0, 7))).toBe(".......");
		expect(lit(litSegments(0.05, 7))).toBe("...#...");
		expect(lit(litSegments(0.34, 7))).toBe("..###..");
		expect(lit(litSegments(0.67, 7))).toBe(".#####.");
		expect(lit(litSegments(1, 7))).toBe("#######");
	});

	it("lights a shorter column through fewer segments at the same level", () => {
		expect(lit(litSegments(0.5, 11))).toBe("...#####...");
		expect(lit(litSegments(0.5, 7))).toBe("..###..");
	});
});
