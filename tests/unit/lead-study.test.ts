import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openCheckpoint } from "../../scripts/self-play/lead-study-checkpoint";
import {
	finishPair,
	nextPair,
	startStudy,
} from "../../scripts/self-play/lead-study-state";

const protocol = {
	arms: ["a", "b"],
	firstSeed: 80,
	screenDeals: 2,
	holdoutDeals: 3,
};

function checkpointPath(test: (path: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "opentrick-lead-study-"));
	try {
		test(join(root, "study"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

describe("lead-study protocol", () => {
	it("shares each screen seed across arms and reserves fresh seeds for holdouts and the next screen", () => {
		const state = startStudy(protocol);
		const collect = () => {
			const trial = nextPair(state);
			finishPair(state, protocol, trial.arm === 1 ? 2 : -1);
			return trial;
		};
		const screen = [collect(), collect(), collect(), collect()] as const;
		expect(screen.map(({ seed, arm }) => [seed, arm])).toEqual([
			[80, 0],
			[80, 1],
			[81, 0],
			[81, 1],
		]);
		expect(screen[0].searchSeed).toBe(screen[1].searchSeed);
		expect(screen[2].searchSeed).toBe(screen[3].searchSeed);
		expect(screen[0].searchSeed).not.toBe(screen[2].searchSeed);
		expect(state.phase).toMatchObject({
			kind: "holdout",
			start: 82,
			arm: 1,
			deals: 3,
		});
		finishPair(state, protocol, 4);
		finishPair(state, protocol, -2);
		const milestone = finishPair(state, protocol, "pair failure");
		expect(milestone).toMatchObject({
			kind: "HOLDOUT",
			start: 82,
			endExclusive: 85,
			candidate: "b",
			shard: { wins: 1, losses: 1, failures: 1, sum: 2, squares: 20 },
		});
		expect(state.recentHoldouts).toMatchObject([{ contrasts: [4, -2, null] }]);
		expect(state.lastFailure).toEqual({
			seed: 84,
			arm: 1,
			message: "pair failure",
		});
		expect(nextPair(state)).toMatchObject({ seed: 85, arm: 0 });
	});

	it("skips a nonpositive or incomplete screen, adapts allocation, and keeps bounded raw history", () => {
		const state = startStudy(protocol);
		for (const result of [3, 0, "failure", -4])
			finishPair(state, protocol, result);
		expect(state.cycles).toBe(1);
		expect(state.phase).toMatchObject({ kind: "screen", start: 82 });
		for (let cycle = 0; cycle < 10; cycle++) {
			for (const result of [1, -1, 1, -1]) finishPair(state, protocol, result);
			const deals = cycle === 0 ? 3 : 6;
			expect(state.phase).toMatchObject({ kind: "holdout", arm: 0, deals });
			for (let board = 0; board < deals; board++)
				finishPair(state, protocol, 1);
		}
		expect(state.recentHoldouts).toHaveLength(8);
		expect(state.evidence[0]).toMatchObject({ wins: 57, sum: 57 });
		expect(state.cycles).toBe(11);
	});
});

describe.skipIf(process.platform !== "linux")("lead-study checkpoint", () => {
	it("does not claim a shared checkpoint directory", () => {
		checkpointPath((path) => {
			mkdirSync(path);
			chmodSync(path, 0o777);
			expect(() => openCheckpoint(path, "revision")).toThrow(
				/private directory/,
			);
		});
	});
	it("locks out a second worker and resumes the exact next pair after interrupted staging", () => {
		checkpointPath((path) => {
			const state = startStudy(protocol);
			const checkpoint = openCheckpoint(path, "revision-a");
			try {
				expect(checkpoint.state).toBeUndefined();
				expect(() => openCheckpoint(path, "revision-a")).toThrow(
					/cannot lock/i,
				);
				finishPair(state, protocol, 1);
				checkpoint.save(state);
			} finally {
				checkpoint.close();
			}
			writeFileSync(join(path, "pending"), "interrupted");
			const resumed = openCheckpoint(path, "revision-a");
			try {
				expect(resumed.state).toEqual(state);
				const recovered = resumed.state;
				if (!recovered) throw new Error("missing committed checkpoint");
				expect(nextPair(recovered)).toMatchObject({ seed: 80, arm: 1 });
				for (const result of [-1, 2, -1, 5])
					finishPair(recovered, protocol, result);
				resumed.save(recovered);
			} finally {
				resumed.close();
			}
			const holdout = openCheckpoint(path, "revision-a");
			try {
				expect(holdout.state).toMatchObject({
					phase: { kind: "holdout", contrasts: [5] },
				});
				const recovered = holdout.state;
				if (!recovered) throw new Error("missing committed holdout");
				expect(nextPair(recovered)).toMatchObject({ seed: 83, arm: 0 });
			} finally {
				holdout.close();
			}
		});
	});

	it("refuses unrelated files, incompatible revisions and corrupt snapshots without overwriting", () => {
		checkpointPath((path) => {
			writeFileSync(path, "user data");
			expect(() => openCheckpoint(path, "revision-a")).toThrow();
			expect(readFileSync(path, "utf8")).toBe("user data");
			rmSync(path);
			const checkpoint = openCheckpoint(path, "revision-a");
			try {
				const state = startStudy(protocol);
				finishPair(state, protocol, 1);
				checkpoint.save(state);
			} finally {
				checkpoint.close();
			}
			const snapshot = join(path, "snapshot.json");
			const valid = readFileSync(snapshot, "utf8");
			expect(() => openCheckpoint(path, "revision-b")).toThrow(
				/engine or protocol changed/,
			);
			expect(readFileSync(snapshot, "utf8")).toBe(valid);
			writeFileSync(snapshot, "corrupt");
			expect(() => openCheckpoint(path, "revision-a")).toThrow(
				/cannot resume/i,
			);
			expect(readFileSync(snapshot, "utf8")).toBe("corrupt");
		});
	});
});
