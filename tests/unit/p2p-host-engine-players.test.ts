import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEAT_GRACE_MS, TABLE_IDLE_MS } from "../../src/p2p/limits";
import { CLIENT_REPORT_FEATURE, type CtlMessage } from "../../src/p2p/wire";
import { syncDigest } from "./fake-mesh";
import { CONFIG, commandId } from "./p2p-fixtures";
import {
	CLIENT_E,
	CLIENT_S,
	EAST,
	EAST2,
	HOST,
	Rig,
	SOUTH,
} from "./p2p-host-engine-fixtures";

let restoreDigest: () => void;
beforeEach(() => {
	restoreDigest = syncDigest();
});
afterEach(() => restoreDigest());

describe("player reports", () => {
	const REPORTS = [CLIENT_REPORT_FEATURE];
	const BUILD = { commit: "1d12f39", date: "2026-10-24T13:29:07+02:00" };
	const report = (commit: string): CtlMessage => ({
		k: "report",
		build: { ...BUILD, commit },
		detail: { screen: { width: 1910, height: 800 } },
	});

	it("asks a player for a report when the player takes a seat, and keeps the latest report of the seat", async () => {
		const rig = await new Rig().create();
		await rig.hello(EAST, CLIENT_E, null, REPORTS);
		expect(rig.to(EAST).map((message) => message.k)).not.toContain(
			"report-request",
		);
		await rig.from(EAST, { k: "claim-seat", req: 1, seat: "E" });
		expect(
			rig.to(EAST).filter((message) => message.k === "report-request"),
		).toEqual([{ k: "report-request" }]);

		await rig.from(EAST, report("aaaaaaa"));
		await rig.from(EAST, report("bbbbbbb"));
		expect(rig.host.reports()).toEqual([
			{
				seat: "E",
				build: { ...BUILD, commit: "bbbbbbb" },
				detail: { screen: { width: 1910, height: 800 } },
				receivedAt: rig.clock.wall(),
			},
		]);
		expect(rig.reportChanges).toBe(2);
		rig.host.leave(EAST);
		expect(rig.host.reports()).toEqual([]);
	});

	it("ignores a report from a page without a seat", async () => {
		const rig = await new Rig().create();
		await rig.hello(EAST, CLIENT_E, null, REPORTS);
		await rig.from(EAST, report("aaaaaaa"));
		expect(rig.host.reports()).toEqual([]);
		expect(rig.reportChanges).toBe(0);
	});

	it("asks for reports and reloads only the pages that understand them, never a bot or an older page", async () => {
		const rig = await new Rig().create();
		await rig.seat(EAST, CLIENT_E, "E", REPORTS);
		await rig.seat(SOUTH, CLIENT_S, "S");
		await rig.hello(EAST2, "clientE2-0123456789abc", null, REPORTS);
		expect(await rig.host.setBotSeat("W", true)).toBe(true);
		rig.sent.take();

		expect(rig.host.requestReports()).toBe(1);
		expect(rig.host.reloadPeers()).toBe(2);
		expect(
			rig.sent
				.take()
				.filter((item) => item.channel === "ctl")
				.map((item) => [item.to, item.message]),
		).toEqual([
			[EAST, { k: "report-request" }],
			[EAST, { k: "reload" }],
			[EAST2, { k: "reload" }],
		]);
	});
});

describe("round trips", () => {
	it("leaves measurement to each page instead of probing or distributing quality during replication", async () => {
		const rig = await new Rig().create();
		const east = await rig.seat(EAST, CLIENT_E, "E", ["round-trip-v1"]);
		await rig.seat(SOUTH, CLIENT_S, "S");
		expect(await rig.host.setBotSeat("W", true)).toBe(true);
		rig.sent.take();

		await rig.command(EAST, 2, east);
		rig.host.tick();
		expect(rig.sent.of("ping")).toEqual([]);
	});
});

describe("player names", () => {
	it("requires the next occupant's name after a self-naming seat is released", async () => {
		const rig = await new Rig().create({
			...CONFIG,
			names: { ...CONFIG.names, E: "player" },
		});
		await rig.hello(EAST, CLIENT_E);
		await rig.from(EAST, {
			k: "claim-seat",
			req: 1,
			seat: "E",
			gen: 0,
			nameRevision: 0,
			name: "Alice",
		});
		rig.host.leave(EAST);
		await rig.from(HOST, { k: "release", req: 1, seat: "E" });
		expect(rig.row("E")).toMatchObject({ holder: null, gen: 2 });
		expect(rig.log.table?.players?.E).toEqual({
			name: "player",
			askOnEntry: true,
			rev: 3,
		});
		await rig.hello(SOUTH, CLIENT_S);
		await rig.from(SOUTH, {
			k: "claim-seat",
			req: 1,
			seat: "E",
			gen: 2,
			nameRevision: 3,
		});
		expect(rig.to(SOUTH)).toContainEqual({
			k: "seat-result",
			req: 1,
			ok: false,
			code: "name_required",
		});
		await rig.from(SOUTH, {
			k: "claim-seat",
			req: 2,
			seat: "E",
			gen: 2,
			nameRevision: 3,
			name: "Bea",
		});
		expect(rig.log.table?.players?.E).toEqual({
			name: "Bea",
			askOnEntry: true,
			rev: 4,
		});
		await rig.command(EAST, 58, 1, "stale");
		expect(rig.log.table?.rev).toBe(4);
	});
	it("requires a supplied name for an unnamed seat and uses it in later chat events", async () => {
		const rig = await new Rig().create({
			...CONFIG,
			names: { ...CONFIG.names, E: "player" },
		});
		await rig.hello(EAST, CLIENT_E);
		await rig.from(EAST, {
			k: "claim-seat",
			req: 1,
			seat: "E",
			gen: 0,
			nameRevision: 0,
		});
		expect(rig.to(EAST)).toContainEqual({
			k: "seat-result",
			req: 1,
			ok: false,
			code: "name_required",
		});
		expect(rig.row("E")?.holder).toBeNull();
		await rig.from(EAST, {
			k: "claim-seat",
			req: 2,
			seat: "E",
			gen: 0,
			nameRevision: 0,
			name: "Alice",
		});
		expect(rig.log.table?.players?.E).toEqual({
			name: "Alice",
			askOnEntry: true,
			rev: 2,
		});
		await rig.command(EAST, 54, 1, "hello");
		expect(rig.log.entries.at(-1)?.event).toMatchObject({
			fromName: "Alice",
			text: "hello",
		});
		const state = rig.log.table?.state;
		expect(await rig.host.renameSeat("E", "Alicia", 1, 2, true)).toBe(true);
		expect(rig.log.table?.state).toBe(state);
		expect(rig.row("E")?.gen).toBe(1);
		expect(await rig.host.renameSeat("E", "Outdated", 1, 2, false)).toBe(false);
		await rig.from(EAST, {
			k: "claim-seat",
			req: 2,
			seat: "E",
			gen: 0,
			nameRevision: 0,
			name: "Alice",
		});
		expect(rig.log.table?.players?.E.name).toBe("Alicia");
		rig.host.stop();
		rig.start();
		expect(rig.log.table?.players?.E.name).toBe("Alicia");
	});

	it("rejects a stale named claim and keeps a supplied client name from changing a preassigned name", async () => {
		const rig = await new Rig().create();
		await rig.hello(EAST, CLIENT_E);
		expect(await rig.host.renameSeat("E", "Dana", 0, 0, false)).toBe(true);
		await rig.from(EAST, {
			k: "claim-seat",
			req: 1,
			seat: "E",
			gen: 0,
			nameRevision: 0,
			name: "Mallory",
		});
		expect(rig.to(EAST)).toContainEqual({
			k: "seat-result",
			req: 1,
			ok: false,
			code: "stale",
		});
		await rig.from(EAST, {
			k: "claim-seat",
			req: 2,
			seat: "E",
			gen: 0,
			nameRevision: 2,
			name: "Mallory",
		});
		expect(rig.row("E")?.holder).not.toBeNull();
		expect(rig.log.table?.players?.E.name).toBe("Dana");
	});
});

describe("hello", () => {
	it("tells a visitor it is unseated and sends the lobby with the free seats", async () => {
		const rig = await new Rig().create();
		await rig.hello(EAST, CLIENT_E);
		const [welcome, lobby] = rig.to(EAST);
		expect(welcome).toEqual({
			k: "welcome",
			status: "unseated",
			auth: rig.auth,
		});
		expect(lobby).toMatchObject({ k: "lobby", auth: rig.auth, config: CONFIG });
		if (lobby?.k !== "lobby") return;
		expect(lobby.seats).toEqual([
			{
				seat: "N",
				available: false,
				online: true,
				mine: false,
				host: true,
				gen: rig.row("N")?.gen ?? 0,
				nameRevision: 0,
				needsName: false,
			},
			{
				seat: "E",
				available: true,
				online: false,
				mine: false,
				gen: rig.row("E")?.gen ?? 0,
				nameRevision: 0,
				needsName: false,
			},
			{
				seat: "S",
				available: true,
				online: false,
				mine: false,
				gen: rig.row("S")?.gen ?? 0,
				nameRevision: 0,
				needsName: false,
			},
			{
				seat: "W",
				available: true,
				online: false,
				mine: false,
				gen: rig.row("W")?.gen ?? 0,
				nameRevision: 0,
				needsName: false,
			},
		]);
	});

	it("refuses another link version", async () => {
		const rig = await new Rig().create();
		rig.host.join(EAST);
		await rig.from(EAST, { k: "hello", b: "p2p-v9", client: CLIENT_E });
		expect(rig.to(EAST)).toEqual([
			{ k: "welcome", status: "incompatible", auth: rig.auth },
		]);
	});

	it("does not let a second active peer take over a named seat", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		rig.to(EAST);
		await rig.hello(EAST2, CLIENT_E, { seat: "E", gen });
		const [welcome, roster] = rig.to(EAST2);
		expect(welcome).toEqual({
			k: "welcome",
			status: "superseded",
			auth: rig.auth,
			busy: true,
		});
		expect(roster).toBeUndefined();
		expect(rig.to(EAST)).toEqual([]);
		await rig.command(EAST, 8, gen);
		expect(rig.to(EAST)).toContainEqual({
			k: "result",
			id: commandId(8),
			status: "accepted",
			seq: 3,
		});
	});

	it("binds a returning player while the host's bot plays that player's seat", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		rig.host.leave(EAST);
		// A reloaded host restores its saved bot seats before the player's page connects again.
		expect(await rig.host.setBotSeat("E", true)).toBe(true);
		await rig.hello(EAST2, CLIENT_E, { seat: "E", gen });
		expect(rig.to(EAST2)[0]).toEqual({
			k: "welcome",
			status: "bound",
			auth: rig.auth,
			seat: "E",
			gen,
		});
		expect(rig.host.roster()?.bots).toContain("E");
	});

	it("binds the second peer of the same holder and generation after the first one leaves", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		await rig.hello(EAST2, CLIENT_E, { seat: "E", gen });
		rig.to(EAST2);
		rig.host.leave(EAST);
		await rig.hello(EAST2, CLIENT_E, { seat: "E", gen });
		expect(rig.to(EAST2)[0]).toEqual({
			k: "welcome",
			status: "bound",
			auth: rig.auth,
			seat: "E",
			gen,
		});
	});

	it("supersedes a peer whose generation or holder does not match the seat", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		await rig.hello(EAST2, CLIENT_E, { seat: "E", gen: gen + 1 });
		await rig.hello(SOUTH, CLIENT_S, { seat: "E", gen });
		const superseded = { k: "welcome", status: "superseded", auth: rig.auth };
		expect(rig.to(EAST2)).toEqual([superseded]);
		expect(rig.to(SOUTH)).toEqual([superseded]);
		expect(rig.row("E")?.gen).toBe(gen);
	});

	it("tells a page whose seat is free on this table that it is unseated, so it claims the seat again", async () => {
		// After a merge the winning table has no claim of the seat that the page held on the losing table.
		const rig = await new Rig().create();
		await rig.hello(EAST, CLIENT_E, { seat: "E", gen: 3 });
		const [welcome, lobby] = rig.to(EAST);
		expect(welcome).toEqual({
			k: "welcome",
			status: "unseated",
			auth: rig.auth,
		});
		expect(lobby?.k === "lobby" && lobby.seats[1]).toMatchObject({
			seat: "E",
			gen: rig.row("E")?.gen ?? 0,
			nameRevision: 0,
			needsName: false,
			available: true,
		});
		await rig.from(EAST, { k: "claim-seat", req: 1, seat: "E" });
		expect(rig.to(EAST)).toContainEqual({
			k: "seat-result",
			req: 1,
			ok: true,
			seat: "E",
			gen: 1,
		});
	});

	it("lets a page whose seat another browser holds offline wait for SEAT_GRACE_MS, then tells it that it is unseated", async () => {
		const rig = await new Rig().create();
		await rig.seat(SOUTH, CLIENT_S, "E");
		rig.host.leave(SOUTH);
		rig.to(SOUTH);
		await rig.hello(EAST, CLIENT_E, { seat: "E", gen: 1 });
		expect(rig.to(EAST)).toEqual([
			{ k: "welcome", status: "superseded", auth: rig.auth, busy: true },
		]);
		rig.clock.now += SEAT_GRACE_MS;
		await rig.hello(EAST, CLIENT_E, { seat: "E", gen: 1 });
		expect(rig.to(EAST)[0]).toEqual({
			k: "welcome",
			status: "unseated",
			auth: rig.auth,
		});
	});

	it("deletes an expired table, tells every peer and stops", async () => {
		const rig = await new Rig().create();
		rig.clock.now += TABLE_IDLE_MS + 1;
		await rig.hello(EAST, CLIENT_E);
		expect(rig.to(EAST)).toEqual([
			{ k: "welcome", status: "expired", auth: rig.auth },
		]);
		expect(rig.to(null)).toEqual([{ k: "gone", reason: "expired" }]);
		expect(rig.log.expired).toBe(true);
		expect(rig.stops).toEqual(["expired"]);
	});
});
