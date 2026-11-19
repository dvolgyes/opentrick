import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DdsSolver } from "../src/bot/dds-solver";
import { makeBoard, playPair } from "./self-play/arena";
import { leadPolicy, TREATMENTS } from "./self-play/lead-lab";
import { openCheckpoint } from "./self-play/lead-study-checkpoint";
import { finishPair, nextPair, startStudy } from "./self-play/lead-study-state";
import { policy } from "./self-play/policy";

const { values } = parseArgs({
	options: {
		checkpoint: { type: "string" },
		cycle: { type: "boolean" },
		help: { type: "boolean", short: "h" },
		pairs: { type: "string" },
		seed: { type: "string" },
	},
});

function integer(
	value: string,
	min: number,
	max: number,
	label: string,
): number {
	const number = Number(value);
	if (
		!/^\d+$/.test(value) ||
		!Number.isSafeInteger(number) ||
		number < min ||
		number > max
	)
		throw new Error(`${label} must be an integer from ${min} to ${max}`);
	return number;
}

function revision(protocol: unknown): string {
	const root = fileURLToPath(new URL("../", import.meta.url));
	const hash = createHash("sha256");
	hash.update(
		JSON.stringify([process.version, process.platform, process.arch, protocol]),
	);
	function file(path: string, name = path): void {
		const bytes = readFileSync(path);
		hash.update(JSON.stringify([name, bytes.length])).update(bytes);
	}
	function tree(path: string, name: string): void {
		for (const entry of readdirSync(path, { withFileTypes: true }).sort(
			(a, b) => a.name.localeCompare(b.name),
		)) {
			const child = join(path, entry.name);
			const label = `${name}/${entry.name}`;
			if (entry.isDirectory()) tree(child, label);
			else if (entry.isFile()) file(child, label);
		}
	}
	for (const path of [
		"package-lock.json",
		"scripts/lead-study.ts",
		"scripts/self-play/arena.ts",
		"scripts/self-play/lead-lab.ts",
		"scripts/self-play/lead-study-state.ts",
		"scripts/self-play/lead-study-checkpoint.ts",
		"scripts/self-play/policy.ts",
		"src/protocol.ts",
		"src/bot/dds-solver.ts",
		"src/bot/obvious-play.ts",
		"src/bot/rank-classes.ts",
	])
		file(join(root, path), path);
	for (const name of readdirSync(join(root, "src/bot")).sort()) {
		if (name.startsWith("play-") && name.endsWith(".ts"))
			file(join(root, "src/bot", name), `src/bot/${name}`);
	}
	tree(join(root, "src/bridge"), "src/bridge");
	for (const name of ["bridge-dds", "@bridge-tools/core"])
		tree(join(root, "node_modules", name), name);
	return hash.digest("hex");
}

async function study(path: string): Promise<void> {
	const protocol = {
		arms: TREATMENTS,
		firstSeed: integer(values.seed ?? "1700000000", 0, 2 ** 32 - 1, "--seed"),
		screenDeals: 12,
		holdoutDeals: 64,
	};
	const budget = { samples: 3 };
	const pairLimit =
		values.pairs === undefined
			? Infinity
			: integer(values.pairs, 1, Number.MAX_SAFE_INTEGER, "--pairs");
	const engineRevision = revision({ protocol, budget });
	const checkpoint = openCheckpoint(path, engineRevision);
	let stopping = false;
	const stop = () => {
		stopping = true;
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	try {
		const state = checkpoint.state ?? startStudy(protocol);
		const cycleLimit = values.cycle ? state.cycles + 1 : Infinity;
		const solver = await DdsSolver.create();
		const incumbent = policy("incumbent", solver, budget);
		const contenders = protocol.arms.map((name) =>
			leadPolicy(name, solver, budget),
		);
		console.log(
			`READY exploratory ${JSON.stringify({ checkpoint: path, revision: engineRevision, resumedPairs: state.pairs, phase: state.phase.kind, ...protocol, ...budget })}`,
		);
		for (
			let i = 0;
			!stopping && i < pairLimit && state.cycles < cycleLimit;
			i++
		) {
			const { seed, searchSeed, arm } = nextPair(state);
			const contender = contenders[arm];
			if (!contender) throw new Error(`Invalid study arm cursor: ${arm}`);
			const phase = state.phase.kind;
			let failure: Error | undefined;
			let result: number | string;
			try {
				const board = makeBoard(
					seed,
					((seed - protocol.firstSeed) % 80) + 1,
					0,
				);
				result = playPair(board, incumbent, contender, searchSeed).imps;
				if (!Number.isInteger(result) || Math.abs(result) > 24)
					throw new Error(`Invalid paired IMP contrast: ${result}`);
			} catch (error) {
				result = String(error);
				failure = new Error(
					`Lead study failed on ${phase} deal seed ${seed}, arm ${protocol.arms[arm]}`,
					{ cause: error },
				);
			}
			const milestone = finishPair(state, protocol, result);
			checkpoint.save(state);
			if (milestone) {
				const { kind, ...details } = milestone;
				const latest =
					kind === "HOLDOUT" ? state.recentHoldouts.at(-1) : undefined;
				console.log(
					`${kind} exploratory ${JSON.stringify({ ...details, contrasts: latest?.contrasts })}`,
				);
			}
			if (failure) {
				console.error(
					`FAILURE exploratory ${JSON.stringify({ phase, candidate: protocol.arms[arm], ...state.lastFailure })}`,
				);
				throw failure;
			}
			await setImmediate();
		}
		console.log(
			`STOP exploratory ${JSON.stringify({ pairs: state.pairs, cycles: state.cycles, phase: state.phase.kind, interrupted: stopping })}`,
		);
	} finally {
		checkpoint.close();
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
	}
}

if (values.help) {
	console.log(`Usage: node --import tsx scripts/lead-study.ts --checkpoint DIR [--seed N] [--cycle] [--pairs N]

Offline exploratory self-play; never changes the live default. Requires Linux flock.
--checkpoint DIR   Private checkpoint directory (new, empty, or an existing study).
--seed N           First deal seed (default 1700000000); use the same seed when resuming.
--cycle            Stop at the end of the current screen and any selected holdout.
--pairs N          Stop after N additional paired attempts, including failures.
Without a limit, stop at a pair boundary with Ctrl-C or SIGTERM; resume from DIR.
Use nice externally to reduce priority. READY indicates startup, not trial evidence.
SCREEN and HOLDOUT report half-open deal seed ranges and paired IMP summaries.
HOLDOUT also lists each contrast in seed order; null is a failure.
The checkpoint retains eight completed holdouts' raw contrasts and cumulative holdout totals.`);
} else if (!values.checkpoint) {
	throw new Error("--checkpoint DIR is required (see --help)");
} else {
	await study(values.checkpoint);
}
