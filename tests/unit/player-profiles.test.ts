import { describe, expect, it } from "vitest";
import { botSeats } from "../../src/bot/seats";
import { appendCommit, replaceCommit, seatsAfter } from "../../src/p2p/log";
import type { Entry } from "../../src/p2p/wire";
import { parseEntry } from "../../src/p2p/wire";
import { playerName, unnamedPlayer } from "../../src/players";
import {
	AUTH_1,
	CONFIG,
	commandId,
	HOLDER_E,
	TABLE,
	tableRecord,
} from "./p2p-fixtures";

describe("replicated player names", () => {
	it("validates Unicode names and keeps display names separate from bot authority", () => {
		expect(playerName("  Ce\u0301line  ")).toBe("Céline");
		expect(playerName("🂡".repeat(40))).toBe("🂡".repeat(40));
		for (const invalid of [
			"",
			" ",
			"a".repeat(41),
			"Alice\nBob",
			"a\u0000b",
			undefined,
		])
			expect(playerName(invalid)).toBeUndefined();
		expect(unnamedPlayer(" PLAYER ")).toBe(true);
		expect(unnamedPlayer("player1")).toBe(false);
		expect(
			botSeats({
				...CONFIG,
				names: { ...CONFIG.names, N: "Abbot" },
				botSetup: { seats: ["E"], bidder: "sl" },
			}),
		).toEqual(["E"]);
	});
	it("renames a seat without changing ownership or the game, and survives full replay", () => {
		const table = tableRecord();
		const entry: Entry = {
			seq: table.rev + 1,
			auth: table.host,
			prevAuth: table.lastAuth,
			id: commandId(51),
			seat: "E",
			gen: table.seats[1]?.gen ?? 0,
			kind: "seat",
			op: { type: "rename", by: "N", name: "Alice", askOnEntry: true },
			event: { kind: "seat", change: "rename" },
		};
		const changed = appendCommit(table, [entry], table.state, 1000);
		expect(seatsAfter(table.seats, [entry])).toEqual(table.seats);
		expect(changed.table.state).toBe(table.state);
		expect(changed.table).toMatchObject({
			players: { E: { name: "Alice", askOnEntry: true, rev: entry.seq } },
		});
		const claim: Entry = {
			seq: 1,
			auth: AUTH_1,
			prevAuth: null,
			id: commandId(1),
			seat: "E",
			gen: 1,
			kind: "seat",
			op: { type: "claim", holder: HOLDER_E },
			event: { kind: "seat" },
		};
		const replay = replaceCommit(null, {
			tableId: TABLE,
			replica: "E",
			config: CONFIG,
			entries: [claim, { ...entry, seq: 2, prevAuth: AUTH_1, auth: AUTH_1 }],
			state: table.state,
			auth: AUTH_1,
			lastActivityAt: 1000,
		});
		expect(replay.table).toMatchObject({
			players: { E: { name: "Alice", askOnEntry: true, rev: 2 } },
		});
		expect(parseEntry({ ...entry, gen: 0 })).toMatchObject({
			kind: "seat",
			gen: 0,
			op: { type: "rename" },
		});
		expect(
			parseEntry({
				...entry,
				op: { type: "rename", by: "N", askOnEntry: false },
			}),
		).toBeUndefined();
	});
});
