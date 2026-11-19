import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { StudyState } from "./lead-study-state";

const OWNER = "opentrick-lead-study-v1";
const SNAPSHOT = "snapshot.json";
const PENDING = "pending";
const MAX_BYTES = 64 * 1024;

function hash(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

export function openCheckpoint(path: string, revision: string) {
	try {
		mkdirSync(path, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	const directory = openSync(
		path,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	try {
		const info = fstatSync(directory);
		if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
			throw new Error(
				"Lead study requires a private directory owned by the current user",
			);
		const lock = spawnSync("flock", ["-n", "3"], {
			stdio: ["ignore", "ignore", "pipe", directory],
		});
		if (lock.error) throw lock.error;
		if (lock.status !== 0)
			throw new Error(`Cannot lock lead study checkpoint: ${path}`);

		const entries = readdirSync(path);
		if (entries.length === 0) {
			mkdirSync(join(path, OWNER), { mode: 0o700 });
			fsyncSync(directory);
		} else if (
			!entries.includes(OWNER) ||
			!lstatSync(join(path, OWNER)).isDirectory() ||
			entries.some(
				(name) =>
					name !== OWNER &&
					((name !== SNAPSHOT && name !== PENDING) ||
						!lstatSync(join(path, name)).isFile()),
			)
		) {
			throw new Error(`Not a lead study checkpoint directory: ${path}`);
		}

		const snapshot = join(path, SNAPSHOT);
		const pending = join(path, PENDING);
		let state: StudyState | undefined;
		if (entries.includes(SNAPSHOT)) {
			try {
				if (lstatSync(snapshot).size > MAX_BYTES)
					throw new Error("snapshot too large");
				const { payload, checksum } = JSON.parse(
					readFileSync(snapshot, "utf8"),
				);
				if (typeof payload !== "string" || hash(payload) !== checksum)
					throw new Error("checksum mismatch");
				const decoded = JSON.parse(payload);
				if (decoded.format !== OWNER) throw new Error("unknown format");
				if (decoded.revision !== revision)
					throw new Error("engine or protocol changed; use a new checkpoint");
				state = decoded.state as StudyState;
				if (
					!Number.isSafeInteger(state.pairs) ||
					state.pairs <= 0 ||
					!Number.isSafeInteger(state.cycles) ||
					state.cycles < 0 ||
					(state.phase.kind !== "screen" && state.phase.kind !== "holdout") ||
					!Array.isArray(state.evidence) ||
					!Array.isArray(state.recentHoldouts)
				) {
					throw new Error("invalid state");
				}
			} catch (error) {
				throw new Error(
					`Cannot resume lead study checkpoint ${snapshot}: ${String(error)}`,
				);
			}
		}

		return {
			state,
			save(next: StudyState): void {
				const payload = JSON.stringify({
					format: OWNER,
					revision,
					state: next,
				});
				const bytes = JSON.stringify({ payload, checksum: hash(payload) });
				if (Buffer.byteLength(bytes) > MAX_BYTES)
					throw new Error("Lead study checkpoint exceeds its size limit");
				try {
					unlinkSync(pending);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				const fd = openSync(pending, "wx", 0o600);
				try {
					writeFileSync(fd, bytes);
					fsyncSync(fd);
				} finally {
					closeSync(fd);
				}
				renameSync(pending, snapshot);
				fsyncSync(directory);
			},
			close(): void {
				closeSync(directory);
			},
		};
	} catch (error) {
		closeSync(directory);
		throw error;
	}
}
