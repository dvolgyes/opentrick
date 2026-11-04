import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBelowFrom } from "../../src/bridge/deal";
import { createBoard, legalActions } from "../../src/bridge/engine";
import {
	actionPayload,
	createBridgeModule,
	parseBridgeState,
} from "../../src/game/bridge";
import { chatPayload } from "../../src/game/chat";
import { deriveHolder } from "../../src/p2p/keys";
import { HOST_LOST_MS, SEAT_GRACE_MS } from "../../src/p2p/limits";
import type { AutoplayStatus } from "../../src/p2p/wire";
import { PROTOCOL_VERSION } from "../../src/protocol";
import { bidding, DEAL, playing } from "./bridge-fixtures";
import { settle, syncDigest } from "./fake-mesh";
import { CONFIG, commandId, TABLE } from "./p2p-fixtures";
import {
	CLIENT_E,
	CLIENT_N,
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

describe("shared bot engine authority", () => {
	it("records the host bot binding as the source of an accepted bid", async () => {
		const module = createBridgeModule(randomBelowFrom(() => 0));
		const state = {
			...module.initialState(TABLE, CONFIG),
			board: createBoard(1, DEAL),
		};
		const rig = await new Rig(module).create(CONFIG, state);
		expect(await rig.host.activateBots(["E"])).toBe(true);
		const first = parseBridgeState(rig.log.table?.state ?? {}, TABLE)?.board;
		if (!first) throw new Error("missing board");
		await rig.from(HOST, {
			k: "cmd",
			id: commandId(808),
			gen: rig.row("N")?.gen ?? 0,
			payload: actionPayload(TABLE, first, { type: "call", call: "1C" }),
		});
		expect(rig.to(HOST)).toContainEqual(
			expect.objectContaining({ id: commandId(808), status: "accepted" }),
		);
		const second = parseBridgeState(rig.log.table?.state ?? {}, TABLE)?.board;
		if (!second) throw new Error("missing board");
		expect(
			await rig.host.localCommand(
				"E",
				commandId(809),
				actionPayload(TABLE, second, { type: "call", call: "P" }),
			),
		).toMatchObject({ ok: true });
		expect(
			parseBridgeState(rig.log.table?.state ?? {}, TABLE)?.bidHistory,
		).toEqual([{ controller: "seat" }, { controller: "bot" }]);
		rig.host.stop();
	});

	it("accepts the host's change and rejects a guest's change", async () => {
		const rig = await new Rig(
			createBridgeModule(randomBelowFrom(() => 0)),
		).create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		const payload = {
			v: PROTOCOL_VERSION,
			roomId: TABLE,
			type: "bot-bidder",
			bidder: "rl-fsp",
		};
		await rig.from(EAST, { k: "cmd", id: commandId(811), gen, payload });
		expect(rig.to(EAST)).toContainEqual(
			expect.objectContaining({ id: commandId(811), status: "rejected" }),
		);
		await rig.from(HOST, {
			k: "cmd",
			id: commandId(812),
			gen: rig.row("N")?.gen ?? 0,
			payload,
		});
		expect(rig.to(HOST)).toContainEqual(
			expect.objectContaining({ id: commandId(812), status: "accepted" }),
		);
		expect(parseBridgeState(rig.log.table?.state ?? {}, TABLE)).toMatchObject({
			botBidder: "rl-fsp",
		});
		expect(await rig.host.setBotSeat("N", true)).toBe(true);
		expect(
			await rig.host.localCommand("N", commandId(813), {
				...payload,
				bidder: "sl",
			}),
		).toMatchObject({ ok: false });
		expect(parseBridgeState(rig.log.table?.state ?? {}, TABLE)?.botBidder).toBe(
			"rl-fsp",
		);
		rig.host.stop();
	});

	it("rejects a previous-version client without changing the stored game", async () => {
		const rig = await new Rig(
			createBridgeModule(randomBelowFrom(() => 0)),
		).create();
		const before = rig.log.table?.state;
		rig.host.join(EAST);
		await rig.from(EAST, { k: "hello", b: "p2p-v1", client: CLIENT_E });
		expect(rig.to(EAST)).toContainEqual(
			expect.objectContaining({ k: "welcome", status: "incompatible" }),
		);
		expect(rig.log.table?.state).toEqual(before);
		rig.host.stop();
	});

	it("upgrades an older saved game without changing its board or inventing bid origins", async () => {
		const module = createBridgeModule(randomBelowFrom(() => 0));
		const initial = module.initialState(TABLE, CONFIG);
		const { botBidder: _bidder, ...old } = initial;
		const board = bidding(createBoard(1, DEAL), "1C P");
		const rig = await new Rig(module).create(CONFIG, { ...old, board });
		const payload = {
			v: PROTOCOL_VERSION,
			roomId: TABLE,
			type: "bot-bidder",
			bidder: "sl",
		};
		await rig.from(HOST, {
			k: "cmd",
			id: commandId(814),
			gen: rig.row("N")?.gen ?? 0,
			payload,
		});
		expect(rig.to(HOST)).toContainEqual(
			expect.objectContaining({ id: commandId(814), status: "accepted" }),
		);
		expect(parseBridgeState(rig.log.table?.state ?? {}, TABLE)).toMatchObject({
			board,
			botBidder: "sl",
			bidHistory: [null, null],
		});
		rig.host.stop();
		rig.start();
		expect(parseBridgeState(rig.log.table?.state ?? {}, TABLE)).toMatchObject({
			board,
			botBidder: "sl",
			bidHistory: [null, null],
		});
		rig.host.stop();
	});
});

describe("community admission", () => {
	it("admits a replacement only for the one host-opened vacancy and lets a returning holder win the race", async () => {
		const config = {
			...CONFIG,
			community: {
				v: 1 as const,
				holders: {
					N: await deriveHolder(TABLE, CLIENT_N),
					E: await deriveHolder(TABLE, CLIENT_E),
					S: await deriveHolder(TABLE, CLIENT_S),
					W: await deriveHolder(TABLE, "clientW-0123456789abcd"),
				},
			},
		};
		const rig = await new Rig().create(config);
		const originalGen = await rig.seat(EAST, CLIENT_E, "E", ["community-v1"]);
		rig.host.leave(EAST);
		rig.clock.now += SEAT_GRACE_MS + 1;
		expect(await rig.host.setCommunityCover("E", 1)).toBe(true);
		expect(await rig.host.setCommunityRecruitment("E", "online")).toBe(true);
		await rig.hello(EAST2, "replace-0123456789abcd", null, ["community-v1"]);
		expect(rig.to(EAST2)).toContainEqual(
			expect.objectContaining({ k: "welcome", status: "unseated" }),
		);
		await rig.hello(EAST, CLIENT_E, { seat: "E", gen: originalGen }, [
			"community-v1",
		]);
		await rig.from(EAST2, { k: "claim-seat", req: 1, seat: "E" });
		expect(rig.to(EAST2)).toContainEqual(
			expect.objectContaining({ k: "seat-result", ok: false, code: "taken" }),
		);
		expect(rig.row("E")?.holder).toBe(await deriveHolder(TABLE, CLIENT_E));
	});

	it("accepts the first replacement claim and closes that vacancy", async () => {
		const config = {
			...CONFIG,
			community: {
				v: 1 as const,
				holders: {
					N: await deriveHolder(TABLE, CLIENT_N),
					E: await deriveHolder(TABLE, CLIENT_E),
					S: await deriveHolder(TABLE, CLIENT_S),
					W: await deriveHolder(TABLE, "clientW-0123456789abcd"),
				},
			},
		};
		const rig = await new Rig().create(config);
		await rig.seat(EAST, CLIENT_E, "E", ["community-v1"]);
		rig.host.leave(EAST);
		rig.clock.now += SEAT_GRACE_MS + 1;
		await rig.host.setCommunityCover("E", 1);
		await rig.host.setCommunityRecruitment("E", "online");
		expect(rig.row("E")).toMatchObject({ coverBoard: 1, recruiting: "online" });
		const replacement = "replace-0123456789abcd";
		const gen = await rig.seat(
			EAST2,
			replacement,
			"E",
			["community-v1"],
			"Replacement",
		);
		expect(gen).toBe(2);
		expect(rig.row("E")).toMatchObject({
			holder: await deriveHolder(TABLE, replacement),
			gen: 2,
			coverBoard: 1,
		});
		expect(rig.row("E")?.recruiting).toBeUndefined();
		expect(rig.host.roster()?.bots).toContain("E");
		await rig.hello(EAST, CLIENT_E, { seat: "E", gen: 1 }, ["community-v1"]);
		expect(rig.to(EAST)).toContainEqual(
			expect.objectContaining({ k: "welcome", status: "superseded" }),
		);
		expect(await rig.host.setCommunityCover("E", null)).toBe(true);
		expect(rig.host.roster()?.bots).not.toContain("E");
	});

	it("persists host approval for a permanent community bot across host reload", async () => {
		const config = {
			...CONFIG,
			community: {
				v: 1 as const,
				holders: {
					N: await deriveHolder(TABLE, CLIENT_N),
					E: await deriveHolder(TABLE, CLIENT_E),
					S: await deriveHolder(TABLE, CLIENT_S),
					W: await deriveHolder(TABLE, "clientW-0123456789abcd"),
				},
			},
		};
		const rig = await new Rig().create(config);
		await rig.seat(EAST, CLIENT_E, "E", ["community-v1"]);
		rig.host.leave(EAST);
		expect(await rig.host.setCommunityBot("E", true)).toBe(true);
		expect(rig.row("E")?.communityBot).toBe(true);
		rig.host.stop();
		rig.start();
		expect(rig.host.roster()?.bots).toContain("E");
	});

	it("persists temporary bot cover without replacing the human seat, including host restart", async () => {
		const config = {
			...CONFIG,
			community: {
				v: 1 as const,
				holders: {
					N: await deriveHolder(TABLE, CLIENT_N),
					E: await deriveHolder(TABLE, CLIENT_E),
					S: await deriveHolder(TABLE, CLIENT_S),
					W: await deriveHolder(TABLE, "clientW-0123456789abcd"),
				},
			},
		};
		const rig = await new Rig().create(config);
		const gen = await rig.seat(EAST, CLIENT_E, "E", ["community-v1"]);
		const holder = rig.row("E")?.holder;
		rig.host.leave(EAST);
		await rig.from(HOST, { k: "release", req: 91, seat: "E" });
		expect(rig.row("E")).toMatchObject({ holder, gen });
		expect(await rig.host.setCommunityCover("E", 1)).toBe(true);
		expect(rig.row("E")).toMatchObject({ holder, gen, coverBoard: 1 });
		rig.host.stop();
		rig.start();
		expect(rig.host.roster()?.bots).toContain("E");
		await rig.hello(EAST, CLIENT_E, { seat: "E", gen }, ["community-v1"]);
		await rig.from(EAST, { k: "autoplay-request", req: 1, enabled: false });
		expect(rig.autoplayRequests).toEqual([]);
		expect(
			rig
				.to(EAST)
				.some(
					(message) =>
						message.k === "autoplay-result" && message.status === "failed",
				),
		).toBe(true);
		await rig.command(EAST, 711, gen);
		expect(
			rig
				.to(EAST)
				.some(
					(message) => message.k === "result" && message.status === "rejected",
				),
		).toBe(true);
		expect(await rig.host.setCommunityCover("E", null)).toBe(true);
		expect(rig.row("E")).toEqual({ seat: "E", holder, gen });
		await rig.command(EAST, 712, gen);
		expect(
			rig
				.to(EAST)
				.some(
					(message) => message.k === "result" && message.status === "accepted",
				),
		).toBe(true);
		// The covered seat can itself become host. It still uses the bot actor until the boundary.
		expect(await rig.host.setCommunityCover("N", 1)).toBe(true);
		rig.host.stop();
		rig.start();
		expect(
			await rig.host.localCommand(
				"N",
				commandId(713),
				chatPayload(TABLE, "covered host"),
			),
		).toMatchObject({ ok: true });
		await rig.command(HOST, 714, rig.row("N")?.gen ?? 0);
		expect(
			rig
				.to(HOST)
				.some(
					(message) => message.k === "result" && message.status === "rejected",
				),
		).toBe(true);
		expect(await rig.host.setCommunityCover("N", null)).toBe(true);
		expect(
			await rig.host.localCommand(
				"N",
				commandId(715),
				chatPayload(TABLE, "stale bot"),
			),
		).toMatchObject({ ok: false });
	});
	it("admits only the assigned holder and keeps an absent player's reservation beyond the grace period", async () => {
		const config = {
			...CONFIG,
			community: {
				v: 1 as const,
				holders: {
					N: await deriveHolder(TABLE, CLIENT_N),
					E: await deriveHolder(TABLE, CLIENT_E),
					S: await deriveHolder(TABLE, CLIENT_S),
					W: await deriveHolder(TABLE, "clientW-0123456789abcd"),
				},
			},
		};
		const rig = await new Rig().create(config);
		await rig.seat(EAST, CLIENT_E, "E", ["community-v1"]);
		rig.host.leave(EAST);
		rig.clock.now += SEAT_GRACE_MS + HOST_LOST_MS + 1;
		await rig.hello(EAST2, CLIENT_S, null, ["community-v1"]);
		await rig.from(EAST2, { k: "claim-seat", req: 2, seat: "E" });
		expect(
			rig
				.to(EAST2)
				.some((message) => message.k === "seat-result" && message.ok),
		).toBe(false);
		expect(rig.row("E")?.holder).toBe(await deriveHolder(TABLE, CLIENT_E));
	});
	it("rejects a client that cannot enforce community rules", async () => {
		const config = {
			...CONFIG,
			community: {
				v: 1 as const,
				holders: {
					N: await deriveHolder(TABLE, CLIENT_N),
					E: await deriveHolder(TABLE, CLIENT_E),
					S: await deriveHolder(TABLE, CLIENT_S),
					W: await deriveHolder(TABLE, "clientW-0123456789abcd"),
				},
			},
		};
		const rig = await new Rig().create(config);
		await rig.hello(EAST, CLIENT_E);
		expect(
			rig
				.to(EAST)
				.some(
					(message) =>
						message.k === "welcome" && message.status === "incompatible",
				),
		).toBe(true);
	});
});

describe("test kit", () => {
	it("the synchronous digest gives the same holder as Web Crypto", async () => {
		const spied = await deriveHolder(TABLE, CLIENT_E);
		restoreDigest();
		const real = await deriveHolder(TABLE, CLIENT_E);
		restoreDigest = syncDigest();
		expect(spied).toBe(real);
	});
});

describe("host-local bots", () => {
	it.each(["S2", "S2 C2 SA"])(
		"accepts remote human dummy's card with robot declarer after %s",
		async (cards) => {
			const module = createBridgeModule(randomBelowFrom(() => 0));
			const board = playing(bidding(createBoard(1, DEAL), "P 1C P P P"), cards);
			const rig = await new Rig(module).create(CONFIG, {
				...module.initialState(TABLE, CONFIG),
				board,
			});
			const gen = await rig.seat(EAST, CLIENT_E, "W");
			expect(await rig.host.activateBots(["E"])).toBe(true);
			const action = legalActions(board, "E")[0];
			if (action?.type !== "play") throw new Error("no card to play");
			const payload = actionPayload(TABLE, board, action);
			expect(
				(await rig.host.localCommand("E", commandId(50), payload)).ok,
			).toBe(false);
			await rig.from(HOST, {
				k: "cmd",
				id: commandId(51),
				gen: rig.row("N")?.gen ?? 0,
				payload,
			});
			expect(rig.to(HOST)).toContainEqual(
				expect.objectContaining({ id: commandId(51), status: "rejected" }),
			);
			await rig.from(EAST, { k: "cmd", id: commandId(52), gen, payload });
			expect(rig.to(EAST)).toContainEqual(
				expect.objectContaining({ id: commandId(52), status: "accepted" }),
			);
			const state = rig.log.table?.state;
			if (!state) throw new Error("no table state");
			expect(parseBridgeState(state, TABLE)?.board?.cards).toEqual([
				...board.cards,
				action.card,
			]);
			expect(rig.log.entries.at(-1)).toMatchObject({ seat: "W", kind: "cmd" });
		},
	);

	it("rejects autoplay without an authenticated current seat and ignores duplicate requests", async () => {
		const rig = await new Rig().create();
		await rig.hello(EAST, CLIENT_E);
		await rig.from(EAST, { k: "autoplay-request", req: 1, enabled: true });
		expect(rig.to(EAST)).toContainEqual({
			k: "autoplay-result",
			req: 1,
			status: "failed",
		});
		expect(rig.autoplayRequests).toEqual([]);

		const gen = await rig.seat(EAST2, "clientE2-0123456789abc", "E");
		const holder = rig.row("E")?.holder;
		let resolve: ((status: AutoplayStatus) => void) | undefined;
		rig.autoplay = () =>
			new Promise((done) => {
				resolve = done;
			});
		const request = { k: "autoplay-request", req: 2, enabled: true } as const;
		await rig.from(EAST2, request);
		await rig.from(EAST2, request);
		expect(rig.autoplayRequests).toEqual([{ seat: "E", enabled: true }]);
		expect(rig.row("E")).toEqual({ seat: "E", holder, gen });
		resolve?.("enabled");
		await settle();
		expect(rig.to(EAST2)).toContainEqual({
			k: "autoplay-result",
			req: 2,
			status: "enabled",
		});
	});

	it("rejects unavailable autoplay without changing the player's seat", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		const holder = rig.row("E")?.holder;
		rig.to(EAST);
		await rig.from(EAST, { k: "autoplay-request", req: 1, enabled: true });
		expect(rig.to(EAST)).toContainEqual({
			k: "autoplay-result",
			req: 1,
			status: "unavailable",
		});
		expect(rig.row("E")).toEqual({ seat: "E", holder, gen });
		expect(rig.host.roster()?.bots).not.toContain("E");
	});

	it("lets a player return control after host autoplay and keeps their seat", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		const holder = rig.row("E")?.holder;
		rig.to(EAST);
		rig.autoplay = async (seat, enabled) =>
			(await rig.host.setBotSeat(seat, enabled))
				? enabled
					? "enabled"
					: "disabled"
				: "failed";

		await rig.from(EAST, { k: "autoplay-request", req: 1, enabled: true });
		expect(rig.to(EAST)).toContainEqual({
			k: "autoplay-result",
			req: 1,
			status: "enabled",
		});
		expect(rig.row("E")).toEqual({ seat: "E", holder, gen });
		expect(rig.host.roster()?.bots).toContain("E");
		// The player asked for the bot, so the player stays at the table, and can stay in the call.
		expect(rig.host.roster()?.autoplaySeats).toEqual(["E"]);
		await rig.command(EAST, 61, gen, "blocked while autoplay is on");
		expect(rig.to(EAST)).toContainEqual(
			expect.objectContaining({ id: commandId(61), status: "rejected" }),
		);

		await rig.from(EAST, { k: "autoplay-request", req: 2, enabled: false });
		expect(rig.to(EAST)).toContainEqual({
			k: "autoplay-result",
			req: 2,
			status: "disabled",
		});
		expect(rig.row("E")).toEqual({ seat: "E", holder, gen });
		expect(rig.host.roster()?.bots).not.toContain("E");
		expect(rig.host.roster()?.autoplaySeats).toEqual([]);
		await rig.command(EAST, 62, gen, "human control restored");
		expect(rig.to(EAST)).toContainEqual(
			expect.objectContaining({ id: commandId(62), status: "accepted" }),
		);
	});

	it("claims bot seats privately and orders their actions through normal validation", async () => {
		const config = { ...CONFIG, names: { ...CONFIG.names, E: "Robot East" } };
		const rig = await new Rig().create(config);
		const activated = await rig.host.activateBots(["E"]);
		expect(activated).toBe(true);
		expect(rig.row("E")?.holder).not.toBeNull();
		expect(rig.host.roster()?.bots).toEqual(["E"]);
		expect(
			rig.host.roster()?.peers.some((binding) => binding.seat === "E"),
		).toBe(false);
		const result = await rig.host.localCommand(
			"E",
			commandId(55),
			chatPayload(TABLE, "hello"),
		);
		expect(result).toEqual({ ok: true });
		expect(rig.log.entries.at(-1)).toMatchObject({ seat: "E", kind: "cmd" });
	});

	it("marks the host's seat and the bots' seats in the lobby", async () => {
		const rig = await new Rig().create();
		expect(await rig.host.activateBots(["E"])).toBe(true);
		await rig.hello(SOUTH, CLIENT_S);
		const lobby = rig.to(SOUTH).findLast((message) => message.k === "lobby");
		expect(lobby?.k === "lobby" && lobby.seats).toEqual([
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
				available: false,
				online: true,
				mine: false,
				bot: true,
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

	it("keeps the bots' seats taken while the host's timer is throttled, as in a background tab", async () => {
		const rig = await new Rig().create();
		expect(await rig.host.activateBots(["E"])).toBe(true);
		// Chrome runs the timers of a hidden tab about once a minute, so no tick runs in this time.
		rig.clock.now += HOST_LOST_MS + SEAT_GRACE_MS;
		await rig.hello(SOUTH, CLIENT_S);
		const lobby = rig.to(SOUTH).findLast((message) => message.k === "lobby");
		expect(lobby?.k === "lobby" && lobby.seats[1]).toEqual({
			seat: "E",
			gen: rig.row("E")?.gen ?? 0,
			nameRevision: 0,
			needsName: false,
			available: false,
			online: true,
			mine: false,
			bot: true,
		});
	});

	it("keeps the configured bots' seats taken before the bots start", async () => {
		const rig = await new Rig().create({
			...CONFIG,
			botSetup: {
				seats: ["E", "W"],
				bidder: "sl",
			},
		});
		rig.clock.now += HOST_LOST_MS + SEAT_GRACE_MS;
		await rig.hello(SOUTH, CLIENT_S);
		const lobby = rig.to(SOUTH).findLast((message) => message.k === "lobby");
		expect(lobby?.k === "lobby" && lobby.seats).toEqual([
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
				available: false,
				online: false,
				mine: false,
				bot: true,
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
				available: false,
				online: false,
				mine: false,
				bot: true,
				gen: rig.row("W")?.gen ?? 0,
				nameRevision: 0,
				needsName: false,
			},
		]);
		await rig.from(SOUTH, { k: "claim-seat", req: 1, seat: "E" });
		expect(rig.row("E")?.holder).toBeNull();
	});

	it("takes back a saved autoplay request after a reload only for a seat that its bot plays", async () => {
		const rig = await new Rig().create();
		await rig.seat(EAST, CLIENT_E, "E");
		expect(rig.host.restoreAutoplay("E")).toBe(false);
		expect(rig.host.roster()?.autoplaySeats).toEqual([]);

		expect(await rig.host.setBotSeat("E", true)).toBe(true);
		expect(rig.host.restoreAutoplay("E")).toBe(true);
		expect(rig.host.roster()?.autoplaySeats).toEqual(["E"]);

		expect(await rig.host.setBotSeat("E", false)).toBe(true);
		expect(rig.host.roster()?.autoplaySeats).toEqual([]);
	});

	it("lets the host automate an active player's seat without ending that player's seat", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		rig.to(EAST);
		const holder = await deriveHolder(TABLE, CLIENT_E);

		expect(await rig.host.setBotSeat("E", true)).toBe(true);
		expect(rig.row("E")).toEqual({ seat: "E", holder, gen });
		expect(rig.host.roster()?.bots).toContain("E");
		// The host chose the bot: the bot plays the seat, so the player's page leaves the call.
		expect(rig.host.roster()?.autoplaySeats).toEqual([]);
		expect(rig.host.roster()?.peers).toContainEqual({
			peer: EAST,
			seat: "E",
			gen,
		});
		expect(await rig.host.activateBots(["E"])).toBe(true);
		expect(
			await rig.host.localCommand(
				"E",
				commandId(56),
				chatPayload(TABLE, "bot action"),
			),
		).toEqual({ ok: true });

		await rig.command(EAST, 57, gen, "human action while automated");
		expect(rig.to(EAST)).toContainEqual(
			expect.objectContaining({
				k: "result",
				id: commandId(57),
				status: "rejected",
			}),
		);

		expect(await rig.host.setBotSeat("E", false)).toBe(true);
		expect(rig.row("E")).toEqual({ seat: "E", holder, gen });
		expect(rig.host.roster()?.bots).not.toContain("E");
		expect(rig.host.roster()?.peers).toContainEqual({
			peer: EAST,
			seat: "E",
			gen,
		});
		await rig.command(EAST, 58, gen, "human action after automation");
		expect(rig.to(EAST)).toContainEqual(
			expect.objectContaining({
				k: "result",
				id: commandId(58),
				status: "accepted",
			}),
		);
	});

	it("claims a free seat for a bot and frees it when the bot is disabled", async () => {
		const rig = await new Rig().create();
		expect(await rig.host.setBotSeat("E", true)).toBe(true);
		const holder = await deriveHolder(TABLE, "opentrick|host-bot|E");
		expect(rig.row("E")).toEqual({ seat: "E", holder, gen: 1 });
		expect(await rig.host.setBotSeat("E", false)).toBe(true);
		expect(rig.row("E")).toEqual({ seat: "E", holder: null, gen: 2 });
	});
});
