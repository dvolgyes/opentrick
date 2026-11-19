import { createHash } from "node:crypto";
import {
	closeSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DdsSolver } from "../../src/bot/dds-solver";
import { measureOpeningBoard } from "../opening-optimizer";
import {
	addLeadTraining,
	compareLead,
	fitLeadTotals,
	type LeadRule,
	leadTotals,
} from "./opening-fit";
import type { OpeningPayoffs } from "./opening-payoffs";
import { summarize } from "./statistics";

const TRAIN = 64;
const HOLDOUT = 96;
const SIZE = TRAIN + HOLDOUT;
const FIRST = 1_400_000_000;
const CAPACITY = (1_490_000_000 - FIRST) / SIZE;
const STANDARD = { rank: "standard", margin: 1 } as const;
const STRAINS = ["nt", "suit"] as const;
const STATE = "state.json";
const PENDING = "state.tmp";
const OWNER = process.getuid?.();

type Rules = Record<(typeof STRAINS)[number], LeadRule>;
type Measure = (epoch: number, index: number) => OpeningPayoffs;
type Totals = Record<keyof Rules, ReturnType<typeof leadTotals>>;
type Summary = ReturnType<typeof measureEpoch>;
type State = {
	revision: string;
	nextEpoch: number;
	totals: Totals;
	last: Summary | null;
};

function measureEpoch(
	epoch: number,
	totals: Totals,
	prior: Rules,
	measure: Measure,
) {
	let tables = 0;
	let ddsCalls = 0;
	const board = (i: number) => {
		const row = measure(epoch, i);
		tables += row.tables;
		ddsCalls += row.calls;
		return row;
	};
	const strain = (i: number) => (i % 4 === 0 ? "nt" : "suit");
	for (let i = 0; i < TRAIN; i++) addLeadTraining(totals[strain(i)], board(i));
	const rules = {
		nt: fitLeadTotals(totals.nt),
		suit: fitLeadTotals(totals.suit),
	};
	const changed = STRAINS.some(
		(s) =>
			rules[s]?.rank !== prior[s]?.rank ||
			rules[s]?.margin !== prior[s]?.margin,
	);
	const incumbentImps: number[] = [];
	const standardImps: number[] = [];
	const championImps: number[] = [];
	for (let i = TRAIN; i < SIZE; i++) {
		const row = board(i);
		const s = strain(i);
		incumbentImps.push(compareLead(row, rules[s], null));
		standardImps.push(compareLead(row, rules[s], STANDARD));
		championImps.push(compareLead(row, rules[s], prior[s]));
	}
	const incumbent = summarize(incumbentImps);
	const standard = summarize(standardImps);
	const champion = summarize(championImps);
	const alpha = 0.025 / ((epoch + 1) * (epoch + 2));
	const nominate = [incumbent, standard].every(
		(s) =>
			s.wins + s.losses >= 20 &&
			s.lower95 !== null &&
			s.lower95 > 0.05 &&
			s.signP < alpha,
	);
	return {
		type: "epoch" as const,
		epoch,
		first: FIRST + epoch * SIZE,
		nextEpoch: epoch + 1,
		training: { total: TRAIN, nt: TRAIN / 4, suit: (TRAIN * 3) / 4 },
		cumulativeTraining: {
			total: (epoch + 1) * TRAIN,
			nt: ((epoch + 1) * TRAIN) / 4,
			suit: ((epoch + 1) * TRAIN * 3) / 4,
		},
		holdout: { total: HOLDOUT, nt: HOLDOUT / 4, suit: (HOLDOUT * 3) / 4 },
		rules,
		prior,
		changed,
		incumbent,
		standard,
		champion,
		alpha,
		nominate,
		tables,
		ddsCalls,
	};
}

function privateDirectory(directory: string) {
	const stat = lstatSync(directory, { bigint: true });
	if (
		!stat.isDirectory() ||
		Number(stat.uid) !== OWNER ||
		(stat.mode & 0o7777n) !== 0o700n
	)
		throw new Error(
			"The campaign directory must be owned by this user and have mode 0700",
		);
	return stat;
}

function privateFile(path: string) {
	const stat = lstatSync(path);
	if (
		!stat.isFile() ||
		stat.uid !== OWNER ||
		(stat.mode & 0o7777) !== 0o600 ||
		stat.nlink !== 1
	)
		throw new Error(`Expected a private campaign file: ${path}`);
}

function checksum(payload: string) {
	return createHash("sha256").update(payload).digest("hex");
}

function loadState(directory: string, revision: string): State {
	const entries = readdirSync(directory);
	if (!entries.includes(STATE)) throw new Error("Missing campaign state");
	if (entries.some((entry) => entry !== STATE && entry !== PENDING))
		throw new Error("Unexpected file in campaign directory");
	const path = join(directory, STATE);
	privateFile(path);
	const { state, digest } = JSON.parse(readFileSync(path, "utf8")) as {
		state: State;
		digest: string;
	};
	if (!state || checksum(JSON.stringify(state)) !== digest)
		throw new Error("Invalid campaign state checksum");
	if (state.revision !== revision)
		throw new Error("Campaign revision does not match");
	if (
		!Number.isSafeInteger(state.nextEpoch) ||
		state.nextEpoch < 0 ||
		state.nextEpoch > CAPACITY ||
		(state.last?.nextEpoch ?? 0) !== state.nextEpoch ||
		STRAINS.some((s) => state.totals[s].length !== 16)
	)
		throw new Error("Invalid campaign state");
	if (entries.includes(PENDING)) {
		const pending = join(directory, PENDING);
		privateFile(pending);
		unlinkSync(pending);
	}
	return state;
}

function saveState(directory: string, state: State) {
	const payload = JSON.stringify(state);
	const pending = join(directory, PENDING);
	const fd = openSync(pending, "wx", 0o600);
	try {
		writeFileSync(fd, `{"digest":"${checksum(payload)}","state":${payload}}\n`);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	renameSync(pending, join(directory, STATE));
	const dirFd = openSync(directory, "r");
	try {
		fsyncSync(dirFd);
	} finally {
		closeSync(dirFd);
	}
}

/** Run under an exclusive lock held by the caller for the entire invocation. */
export function runCampaign(
	directory: string,
	mode: "init" | "resume",
	revision: string,
	count: number,
	measure: Measure,
	publish: (summary: Summary) => void,
	ready?: (epoch: number) => void,
) {
	privateDirectory(directory);
	let state: State;
	if (mode === "init") {
		if (readdirSync(directory).length)
			throw new Error("Campaign directory must be empty to initialize");
		state = {
			revision,
			nextEpoch: 0,
			totals: { nt: leadTotals(), suit: leadTotals() },
			last: null,
		};
		saveState(directory, state);
	} else {
		state = loadState(directory, revision);
	}
	const start = state.nextEpoch;
	const stop = Math.min(CAPACITY, start + count);
	if (!(stop > start)) throw new Error("No remaining campaign epochs to run");
	ready?.(start);
	let prior: Rules = state.last?.rules ?? { nt: null, suit: null };
	let summary: Summary;
	do {
		summary = measureEpoch(state.nextEpoch, state.totals, prior, measure);
		state.nextEpoch = summary.nextEpoch;
		state.last = summary;
		saveState(directory, state);
		publish(summary);
		prior = summary.rules;
	} while (state.nextEpoch < stop);
	return summary;
}

function sourceRevision() {
	const root = fileURLToPath(new URL("../../", import.meta.url));
	const hash = createHash("sha256").update(
		`${process.version}\0${process.platform}\0${process.arch}\0`,
	);
	const add = (relative: string) => {
		const path = join(root, relative);
		const stat = lstatSync(path);
		if (stat.isDirectory()) {
			for (const name of readdirSync(path).sort()) add(join(relative, name));
		} else if (stat.isFile()) {
			hash.update(`${relative}\0${stat.size}\0`).update(readFileSync(path));
		} else {
			throw new Error(`Cannot fingerprint ${relative}`);
		}
	};
	for (const path of [
		"src",
		"scripts/self-play",
		"scripts/opening-optimizer.ts",
		"tsconfig.json",
		"package.json",
		"package-lock.json",
		"node_modules/bridge-dds",
		"node_modules/@bridge-tools/core",
	])
		add(path);
	return hash.digest("hex");
}

function requireWriterLock(directory: string) {
	const dir = privateDirectory(directory);
	const fd = fstatSync(9, { bigint: true });
	const info = readFileSync("/proc/self/fdinfo/9", "utf8");
	if (
		fd.dev === dir.dev &&
		fd.ino === dir.ino &&
		/^lock:\s+\d+: FLOCK\s+ADVISORY\s+WRITE\s/m.test(info)
	)
		return;
	throw new Error(
		"Hold an exclusive flock on the campaign directory on file descriptor 9",
	);
}

if (
	process.argv[1] &&
	pathToFileURL(process.argv[1]).href === import.meta.url
) {
	const [mode, directory, limit, ...extra] = process.argv.slice(2);
	const count = limit === undefined ? Infinity : Number(limit);
	if (
		(mode !== "init" && mode !== "resume") ||
		!directory ||
		extra.length ||
		(limit !== undefined &&
			(!/^\d+$/.test(limit) || !Number.isSafeInteger(count) || count < 1))
	)
		throw new Error("Usage: cumulative-leads.ts init|resume DIRECTORY [COUNT]");
	requireWriterLock(directory);
	const revision = sourceRevision();
	const solver = await DdsSolver.create();
	runCampaign(
		directory,
		mode,
		revision,
		count,
		(epoch, i) => measureOpeningBoard(solver, FIRST + epoch * SIZE, i).result,
		(summary) => {
			const line = JSON.stringify(summary);
			console.log(line);
			if (summary.nominate) console.error(`NOMINATION ${line}`);
		},
		(epoch) =>
			console.error(`READY cumulative opening leads: starting epoch ${epoch}`),
	);
}
