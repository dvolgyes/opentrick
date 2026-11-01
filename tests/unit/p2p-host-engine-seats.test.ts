import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dealPayload } from "../../src/game/bridge";
import { chatPayload } from "../../src/game/chat";
import { deriveHolder } from "../../src/p2p/keys";
import {
	HOST_LOST_MS,
	LOBBY_REFRESH_MS,
	MAX_PENDING_PER_SEAT,
	ROSTER_COALESCE_MS,
	SEAT_GRACE_MS,
} from "../../src/p2p/limits";
import { storeClaim } from "../../src/p2p/log";
import type { Entry } from "../../src/p2p/wire";
import { overTheWire, settle, syncDigest } from "./fake-mesh";
import { commandId, TABLE } from "./p2p-fixtures";
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

describe("seats", () => {
	it("a claim of a free seat commits a seat entry with the next generation and broadcasts it", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		expect(gen).toBe(1);
		const holder = await deriveHolder(TABLE, CLIENT_E);
		expect(rig.row("E")).toEqual({ seat: "E", holder, gen: 1 });
		const [message] = rig.entries();
		expect(message?.e).toMatchObject({
			seq: 2,
			auth: rig.auth,
			prevAuth: rig.auth,
			seat: "E",
			gen: 1,
			kind: "seat",
			op: { type: "claim", holder },
		});
		expect(message?.state).toEqual(rig.log.table?.state);
	});

	it("refuses a seat that another holder holds, and a claim without hello", async () => {
		const rig = await new Rig().create();
		await rig.seat(EAST, CLIENT_E, "E");
		await rig.hello(SOUTH, CLIENT_S);
		rig.to(SOUTH);
		await rig.from(SOUTH, { k: "claim-seat", req: 4, seat: "E" });
		expect(rig.to(SOUTH)).toEqual([
			{ k: "seat-result", req: 4, ok: false, code: "taken" },
		]);
		rig.host.join(EAST2);
		await rig.from(EAST2, { k: "claim-seat", req: 5, seat: "W" });
		expect(rig.to(EAST2)).toEqual([
			{ k: "seat-result", req: 5, ok: false, code: "invalid" },
		]);
	});

	it("refuses a same-holder claim while the existing peer is active", async () => {
		const rig = await new Rig().create();
		await rig.seat(EAST, CLIENT_E, "E");
		await rig.hello(EAST2, CLIENT_E);
		rig.to(EAST2);
		await rig.from(EAST2, { k: "claim-seat", req: 6, seat: "E" });
		expect(rig.to(EAST2)).toContainEqual({
			k: "seat-result",
			req: 6,
			ok: false,
			code: "taken",
		});
		expect(rig.row("E")?.holder).toBe(await deriveHolder(TABLE, CLIENT_E));
		await rig.command(EAST, 7, 1);
		expect(rig.to(EAST)).toContainEqual({
			k: "result",
			id: commandId(7),
			status: "accepted",
			seq: 3,
		});
	});

	it("does not bind a second active peer to the same seat generation", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		await rig.hello(EAST2, CLIENT_E, { seat: "E", gen });
		expect(rig.to(EAST2)).toContainEqual({
			k: "welcome",
			status: "superseded",
			auth: rig.auth,
			busy: true,
		});
		await rig.command(EAST, 8, gen);
		expect(rig.to(EAST)).toContainEqual({
			k: "result",
			id: commandId(8),
			status: "accepted",
			seq: 3,
		});
	});

	it("keeps a connected holder's seat until its peer is silent for HOST_LOST_MS, then gives it to another browser", async () => {
		const rig = await new Rig().create();
		await rig.seat(EAST, CLIENT_E, "E");
		await rig.hello(SOUTH, CLIENT_S);
		rig.clock.now += HOST_LOST_MS - 1;
		await rig.from(SOUTH, { k: "claim-seat", req: 8, seat: "E" });
		expect(rig.to(SOUTH)).toContainEqual({
			k: "seat-result",
			req: 8,
			ok: false,
			code: "taken",
		});
		rig.clock.now += 1;
		await rig.from(SOUTH, { k: "claim-seat", req: 9, seat: "E" });
		expect(rig.to(SOUTH)).toContainEqual({
			k: "seat-result",
			req: 9,
			ok: true,
			seat: "E",
			gen: 2,
		});
		expect(rig.row("E")?.holder).toBe(await deriveHolder(TABLE, CLIENT_S));
	});

	it("refuses a connected holder's seat to another browser", async () => {
		const rig = await new Rig().create();
		await rig.seat(EAST, CLIENT_E, "E");
		await rig.hello(SOUTH, CLIENT_S);
		rig.to(SOUTH);
		await rig.from(SOUTH, { k: "claim-seat", req: 7, seat: "E" });
		expect(rig.to(SOUTH)).toContainEqual({
			k: "seat-result",
			req: 7,
			ok: false,
			code: "taken",
		});
		expect(rig.row("E")?.holder).toBe(await deriveHolder(TABLE, CLIENT_E));
	});

	it("keeps a seat for SEAT_GRACE_MS after its holder leaves, then gives it to another browser", async () => {
		const rig = await new Rig().create();
		await rig.seat(EAST, CLIENT_E, "E");
		await rig.hello(SOUTH, CLIENT_S);
		rig.host.leave(EAST);
		rig.clock.now += SEAT_GRACE_MS - 1;
		await rig.from(SOUTH, { k: "claim-seat", req: 8, seat: "E" });
		expect(rig.to(SOUTH)).toContainEqual({
			k: "seat-result",
			req: 8,
			ok: false,
			code: "taken",
		});
		rig.clock.now += 1;
		await rig.from(SOUTH, { k: "claim-seat", req: 9, seat: "E" });
		expect(rig.to(SOUTH)).toContainEqual({
			k: "seat-result",
			req: 9,
			ok: true,
			seat: "E",
			gen: 2,
		});
	});

	it("gives a seat back to its own holder once no peer of the seat is connected, before SEAT_GRACE_MS", async () => {
		const rig = await new Rig().create();
		await rig.seat(EAST, CLIENT_E, "E");
		await rig.hello(SOUTH, CLIENT_S);
		await rig.hello(EAST2, CLIENT_E);
		const ownRow = (messages: ReturnType<Rig["to"]>) => {
			const lobby = messages.findLast((message) => message.k === "lobby");
			return lobby?.k === "lobby"
				? lobby.seats.find((row) => row.seat === "E")
				: undefined;
		};
		expect(ownRow(rig.to(EAST2))).toEqual({
			seat: "E",
			gen: rig.row("E")?.gen ?? 0,
			nameRevision: 0,
			needsName: false,
			available: false,
			online: true,
			mine: true,
		});
		rig.host.leave(EAST);
		await rig.hello(EAST2, CLIENT_E);
		expect(ownRow(rig.to(EAST2))).toEqual({
			seat: "E",
			gen: rig.row("E")?.gen ?? 0,
			nameRevision: 0,
			needsName: false,
			available: true,
			online: false,
			mine: true,
		});
		await rig.from(SOUTH, { k: "claim-seat", req: 8, seat: "E" });
		expect(rig.to(SOUTH)).toContainEqual({
			k: "seat-result",
			req: 8,
			ok: false,
			code: "taken",
		});
		await rig.from(EAST2, { k: "claim-seat", req: 9, seat: "E" });
		expect(rig.to(EAST2)).toContainEqual({
			k: "seat-result",
			req: 9,
			ok: true,
			seat: "E",
			gen: 2,
		});
	});

	it("a bound peer cannot claim another seat", async () => {
		const rig = await new Rig().create();
		await rig.seat(EAST, CLIENT_E, "E");
		await rig.from(EAST, { k: "claim-seat", req: 2, seat: "S" });
		expect(rig.to(EAST)).toContainEqual({
			k: "seat-result",
			req: 2,
			ok: false,
			code: "invalid",
		});
	});

	it("releases an offline seat only, and only for a seated player", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		await rig.from(HOST, { k: "release", req: 7, seat: "E" });
		expect(rig.to(HOST)).toEqual([
			{ k: "release-result", req: 7, ok: false, code: "online" },
		]);
		await rig.from(HOST, { k: "release", req: 8, seat: "S" });
		expect(rig.to(HOST)).toEqual([
			{ k: "release-result", req: 8, ok: false, code: "invalid" },
		]);
		await rig.hello(SOUTH, CLIENT_S);
		await rig.from(SOUTH, { k: "release", req: 9, seat: "E" });
		expect(rig.to(SOUTH)).toContainEqual({
			k: "release-result",
			req: 9,
			ok: false,
			code: "unseated",
		});
		rig.host.leave(EAST);
		rig.entries();
		await rig.from(HOST, { k: "release", req: 10, seat: "E" });
		expect(rig.to(HOST)).toEqual([{ k: "release-result", req: 10, ok: true }]);
		expect(rig.row("E")).toEqual({ seat: "E", holder: null, gen: gen + 1 });
		const [message] = rig.entries();
		expect(message?.e).toMatchObject({
			kind: "seat",
			seat: "E",
			op: { type: "release", by: "N" },
		});
	});

	it("counts a connected seat as offline once its peer is silent for HOST_LOST_MS", async () => {
		const rig = await new Rig().create();
		await rig.seat(EAST, CLIENT_E, "E");
		rig.clock.now += HOST_LOST_MS;
		await rig.from(HOST, { k: "release", req: 3, seat: "E" });
		expect(rig.to(HOST)).toEqual([{ k: "release-result", req: 3, ok: true }]);
	});

	it("sends the lobby to visitors when seats change and every LOBBY_REFRESH_MS", async () => {
		const rig = await new Rig().create();
		await rig.hello(SOUTH, CLIENT_S);
		rig.to(SOUTH);
		await rig.seat(EAST, CLIENT_E, "E");
		const lobby = rig.to(SOUTH).find((message) => message.k === "lobby");
		expect(
			lobby?.k === "lobby" &&
				lobby.seats.find((row) => row.seat === "E")?.available,
		).toBe(false);
		rig.host.tick();
		rig.to(SOUTH);
		rig.clock.now += LOBBY_REFRESH_MS;
		rig.host.tick();
		expect(rig.to(SOUTH).map((message) => message.k)).toContain("lobby");
	});

	it("broadcasts the roster after ROSTER_COALESCE_MS, with acknowledgements and bound peers", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		rig.host.tick();
		rig.sent.take();
		await rig.from(EAST, { k: "ack", rev: 2 });
		rig.host.tick();
		expect(rig.sent.of("roster")).toEqual([]);
		rig.clock.now += ROSTER_COALESCE_MS;
		rig.host.tick();
		const [sent] = rig.sent.of("roster");
		expect(sent?.to).toBeNull();
		expect(sent?.message.peers).toEqual([
			{ peer: HOST, seat: "N", gen: 1 },
			{ peer: EAST, seat: "E", gen },
		]);
		expect(sent?.message.seats.map((row) => [row.seat, row.acked])).toEqual([
			["N", 2],
			["E", 2],
			["S", 0],
			["W", 0],
		]);
	});
});

describe("commands", () => {
	it("rejects a deal command from a non-host seat", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		await rig.from(EAST, {
			k: "cmd",
			id: commandId(10),
			gen,
			payload: dealPayload(TABLE, 1),
		});
		expect(rig.to(EAST)).toEqual([
			{
				k: "result",
				id: commandId(10),
				status: "rejected",
				reason: "only the host can deal boards",
			},
		]);
		expect(rig.log.seqOf(commandId(10))).toBeUndefined();
	});

	it("orders accepted commands, answers the sender and broadcasts each entry with the state", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		rig.entries();
		rig.to(EAST);
		rig.host.receive(
			EAST,
			overTheWire(TABLE, "ctl", {
				k: "cmd",
				id: commandId(10),
				gen,
				payload: chatPayload(TABLE, "first"),
			}),
		);
		await rig.command(EAST, 11, gen, "second");
		expect(rig.to(EAST)).toEqual([
			{ k: "result", id: commandId(10), status: "accepted", seq: 3 },
			{ k: "result", id: commandId(11), status: "accepted", seq: 4 },
		]);
		const sent = rig.entries();
		expect(sent.map((message) => message.e.seq)).toEqual([3, 4]);
		expect(sent[1]?.e).toMatchObject({
			kind: "cmd",
			seat: "E",
			gen,
			payload: chatPayload(TABLE, "second"),
			event: { fromSeat: "E", fromName: "player3", text: "second", seq: 4 },
		});
		expect(sent[1]?.state).toMatchObject({ messages: 2 });
		expect(rig.log.position().rev).toBe(4);
	});

	it("answers a resent command with the stored result and logs it once", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		await rig.command(EAST, 10, gen);
		rig.to(EAST);
		rig.entries();
		await rig.command(EAST, 10, gen);
		expect(rig.to(EAST)).toEqual([
			{ k: "result", id: commandId(10), status: "accepted", seq: 3 },
		]);
		expect(rig.entries()).toEqual([]);
		await rig.command(EAST, 10, gen, "another text");
		expect(rig.to(EAST)).toEqual([
			{ k: "result", id: commandId(10), status: "invalid" },
		]);
		expect(rig.log.position().rev).toBe(3);
	});

	it("takes the seat from the binding and refuses a stale generation or an unbound sender", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		await rig.hello(EAST2, CLIENT_E);
		await rig.from(EAST2, { k: "claim-seat", req: 1, seat: "E" });
		expect(rig.to(EAST2)).toContainEqual({
			k: "seat-result",
			req: 1,
			ok: false,
			code: "taken",
		});
		await rig.command(EAST, 10, gen);
		expect(rig.to(EAST)).toEqual([
			{ k: "result", id: commandId(10), status: "accepted", seq: 3 },
		]);
		await rig.command(EAST2, 11, gen);
		expect(rig.to(EAST2)).toEqual([
			{ k: "result", id: commandId(11), status: "busy" },
		]);
		expect(rig.log.seqOf(commandId(10))).toBe(3);
		expect(rig.log.seqOf(commandId(11))).toBeUndefined();
	});

	it("returns the game's reason for a rejected command and stores nothing", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		const before = rig.storage.commits;
		await rig.command(EAST, 10, gen, "   ");
		expect(rig.to(EAST)).toContainEqual({
			k: "result",
			id: commandId(10),
			status: "rejected",
			reason: "message is empty",
		});
		expect(rig.storage.commits).toBe(before);
	});

	it(`answers busy when a seat has ${MAX_PENDING_PER_SEAT} commands waiting`, async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		rig.to(EAST);
		for (let n = 0; n <= MAX_PENDING_PER_SEAT; n++) {
			rig.host.receive(
				EAST,
				overTheWire(TABLE, "ctl", {
					k: "cmd",
					id: commandId(100 + n),
					gen,
					payload: chatPayload(TABLE, `burst ${n}`),
				}),
			);
		}
		await settle();
		const results = rig.to(EAST);
		expect(results[0]).toEqual({
			k: "result",
			id: commandId(100 + MAX_PENDING_PER_SEAT),
			status: "busy",
		});
		expect(
			results.filter(
				(message) => message.k === "result" && message.status === "accepted",
			),
		).toHaveLength(MAX_PENDING_PER_SEAT);
	});

	it("never accepts a command whose write failed, and stops hosting once", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		rig.to(EAST);
		rig.entries();
		rig.storage.fail = true;
		await rig.command(EAST, 10, gen);
		expect(rig.to(EAST)).toEqual([
			{ k: "result", id: commandId(10), status: "storage" },
		]);
		rig.storage.fail = false;
		await rig.command(EAST, 11, gen);
		expect(rig.to(EAST)).toEqual([
			{ k: "result", id: commandId(11), status: "not_host" },
		]);
		expect(rig.entries()).toEqual([]);
		expect(rig.log.seqOf(commandId(10))).toBeUndefined();
		expect(rig.stops).toEqual(["storage"]);
		expect(rig.host.stopped).toBe(true);
	});

	it("stops with conflict when the stored host changes under it", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		rig.to(EAST);
		const better = { ...rig.auth, inc: rig.auth.inc + 1 };
		await storeClaim(rig.log, better);
		await rig.command(EAST, 10, gen);
		expect(rig.to(EAST)).toEqual([
			{ k: "result", id: commandId(10), status: "not_host" },
		]);
		expect(rig.stops).toEqual(["conflict"]);
	});

	it("a crash between the commit and the broadcast leaves one entry; the resend gets the stored result", async () => {
		const rig = await new Rig().create();
		const gen = await rig.seat(EAST, CLIENT_E, "E");
		await rig.command(EAST, 10, gen);
		// The page dies before its messages leave: nothing it sent arrives.
		rig.sent.take();
		rig.host.stop();
		// The host reloads and resumes its term with the next incarnation.
		rig.auth = { ...rig.auth, inc: rig.auth.inc + 1 };
		await storeClaim(rig.log, rig.auth);
		rig.start();
		await rig.hello(EAST, CLIENT_E, { seat: "E", gen });
		expect(rig.to(EAST)[0]).toMatchObject({ k: "welcome", status: "bound" });
		await rig.command(EAST, 10, gen);
		expect(rig.to(EAST)).toEqual([
			{ k: "result", id: commandId(10), status: "accepted", seq: 3 },
		]);
		const logged = rig.log.entries.filter(
			(entry: Entry) => entry.id === commandId(10),
		);
		expect(logged).toHaveLength(1);
		expect(rig.stops).toEqual([]);
	});
});
