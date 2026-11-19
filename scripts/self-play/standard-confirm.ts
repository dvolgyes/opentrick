import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	fsyncSync,
	linkSync,
	lstatSync,
	openSync,
	readdirSync,
	readFileSync,
	realpathSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { DdsSolver } from "../../src/bot/dds-solver";
import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import {
	alpha,
	boards,
	digest,
	layouts,
	measure,
	type Row,
	report,
	rootMs,
	type Stage,
	stages,
} from "./standard-confirm-measure";

const source = fileURLToPath(new URL("../../", import.meta.url));
const doctor = process.argv[3] === "--doctor";
function checkpointPath(state: string | undefined): string {
	if (
		!state ||
		!isAbsolute(state) ||
		process.argv.length !== (doctor ? 4 : 3)
	) {
		throw new Error(
			"Usage: node --import tsx scripts/self-play/standard-confirm.ts ABSOLUTE_PRIVATE_CHECKPOINT [--doctor]",
		);
	}
	return state;
}
const state = checkpointPath(process.argv[2]);
const dir = openSync(
	state,
	constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
);
const info = fstatSync(dir);
if (
	info.uid !== process.getuid?.() ||
	(info.mode & 0o077) !== 0 ||
	!relative(source, realpathSync(state)).startsWith("../")
) {
	throw new Error(
		"Checkpoint must be a private directory outside the source tree",
	);
}
if (!doctor) {
	const lock = spawnSync("flock", ["-n", "3"], {
		stdio: ["ignore", "ignore", "inherit", dir],
	});
	if (lock.error) throw lock.error;
	if (lock.status !== 0) throw new Error("Checkpoint is already locked");
}

const hash = createHash("sha256");
function hashPath(path: string) {
	const full = join(source, path);
	const entry = lstatSync(full);
	if (entry.isDirectory()) {
		for (const child of readdirSync(full).sort()) hashPath(join(path, child));
	} else if (entry.isFile()) {
		hash
			.update(`${JSON.stringify(path)}:${entry.size}:`)
			.update(readFileSync(full));
	} else throw new Error(`Non-frozen input ${path}`);
}
for (const path of [
	"REVISION",
	"package.json",
	"tsconfig.json",
	"src",
	"scripts/self-play",
	"node_modules",
])
	hashPath(path);
const protocol = {
	version: 1,
	revision: readFileSync(join(source, "REVISION"), "utf8").trim(),
	fingerprint: hash.digest("hex"),
	runtime: process.version,
	platform: process.platform,
	arch: process.arch,
	stages,
	boards,
	rootMs,
	layouts,
	gate: { nonTies: 24, alpha, lower975Above: 0.05 },
};
const identity = digest(protocol);
const emit = (event: unknown) => console.log(JSON.stringify(event));
const entries = readdirSync(state);
function read(name: string) {
	const path = join(state, name);
	if (!lstatSync(path).isFile())
		throw new Error(`Not a regular checkpoint file: ${name}`);
	const { checksum, payload } = JSON.parse(readFileSync(path, "utf8"));
	if (checksum !== digest(payload))
		throw new Error(`Corrupt checkpoint file: ${name}`);
	return payload;
}
let serial = 0;
function save(name: string, payload: unknown) {
	const pending = join(
		state,
		`.pending-${process.pid}-${Date.now()}-${serial++}`,
	);
	const fd = openSync(pending, "wx", 0o600);
	try {
		writeFileSync(
			fd,
			`${JSON.stringify({ checksum: digest(payload), payload })}\n`,
		);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	linkSync(pending, join(state, name));
	fsyncSync(dir);
	unlinkSync(pending);
}

const seen = new Set<string>();
const nameFor = (stage: Stage, i: number) =>
	`${stage}-${stages[stage] + i}.json`;
function accept(row: Row, stage: Stage, i: number) {
	const changed = row.root.card !== row.choice.card;
	const incumbent = row.tables.find((table) => table.lead === row.root.card);
	const candidate = row.tables.find((table) => table.lead === row.choice.card);
	const difference = !changed
		? 0
		: incumbent && candidate
			? candidate.defenderPoints - incumbent.defenderPoints
			: NaN;
	if (
		row.stage !== stage ||
		row.seed !== stages[stage] + i ||
		row.slot !== i % 4 ||
		seen.has(row.dealHash) ||
		row.root.elapsedMs < rootMs ||
		row.root.samples < 2 ||
		row.tables.length !== (changed ? 2 : 0) ||
		row.tables.some(
			(table) =>
				!Number.isInteger(table.scoreNS) ||
				table.defenderPoints !== row.sign * table.scoreNS ||
				table.cards.length !== 52 ||
				table.cards[0] !== table.lead,
		) ||
		row.rawDifference !== difference ||
		row.imps !== scoreDifferenceToImps(difference)
	) {
		throw new Error(`Invalid or duplicate board: ${stage}/${i}`);
	}
	seen.add(row.dealHash);
}

const allowed = new Set(["protocol.json", "invalid.json"]);
const existing = new Set(
	entries.filter((name) => !/^\.pending-\d+-\d+-\d+$/.test(name)),
);
if (existing.has("protocol.json") && digest(read("protocol.json")) !== identity)
	throw new Error("Checkpoint protocol or source fingerprint mismatch");
if (!existing.has("protocol.json") && existing.size !== 0)
	throw new Error("Missing checkpoint protocol");
const data = { screen: [] as Row[], live: [] as Row[] };
for (const stage of ["screen", "live"] as const) {
	const rows = data[stage];
	for (let i = 0; i < boards; i++) {
		const name = nameFor(stage, i);
		allowed.add(name);
		if (!existing.has(name)) continue;
		const { identity: saved, row } = read(name);
		if (saved !== identity || rows.length !== i)
			throw new Error(`Protocol mismatch or missing predecessor: ${name}`);
		accept(row, stage, i);
		rows.push(row);
	}
}
for (const name of existing)
	if (!allowed.has(name))
		throw new Error(`Unexpected checkpoint file: ${name}`);
if (data.live.length > 0 && !report(data.screen).passes)
	throw new Error("Live rows exist without a passed screen");
const invalid = existing.has("invalid.json") ? read("invalid.json") : null;
emit({
	type: "protocol",
	...protocol,
	resumed: { screen: data.screen.length, live: data.live.length },
	invalid,
});
if (doctor) {
	for (const stage of ["screen", "live"] as const)
		emit({ type: "status", stage, ...report(data[stage]) });
} else if (invalid) {
	throw new Error("A board failed; campaign invalid. Inspect with --doctor.");
} else {
	if (!existing.has("protocol.json")) save("protocol.json", protocol);
	let stop = false;
	process.on("SIGINT", () => {
		stop = true;
	});
	process.on("SIGTERM", () => {
		stop = true;
	});
	const solver = await DdsSolver.create();
	for (const stage of ["screen", "live"] as const) {
		if (stop || (stage === "live" && !report(data.screen).passes)) break;
		const rows = data[stage];
		for (let i = rows.length; i < boards && !stop; i++) {
			let row: Row;
			try {
				row = measure(solver, stage, i);
				accept(row, stage, i);
			} catch (error) {
				const failure = {
					identity,
					stage,
					seed: stages[stage] + i,
					error: String(error),
				};
				save("invalid.json", failure);
				emit({ type: "invalid", ...failure });
				throw error;
			}
			save(nameFor(stage, i), { identity, row });
			rows.push(row);
			emit({
				type: "board",
				stage,
				seed: row.seed,
				fixture: row.fixture,
				layoutCount: row.root.samples,
				tables: row.tables.length,
				imps: row.imps,
				elapsedMs: row.elapsedMs,
			});
			await setImmediate();
		}
		emit({ type: stop ? "stopped" : "summary", stage, ...report(rows) });
	}
}
closeSync(dir);
