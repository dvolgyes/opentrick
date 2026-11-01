import { describe, expect, it } from "vitest";
import { createBoard } from "../../src/bridge/engine";
import { countHandPoints } from "../../src/bridge/hand-points";
import { actionPayload, dealPayload } from "../../src/game/bridge";
import type { OutboxItem } from "../../src/p2p/outbox";
import type { Entry } from "../../src/p2p/wire";
import { SEAT_NAMES, type Seat } from "../../src/protocol";
import type { RosterRow } from "../../src/ui/model";
import { autoDealBoard } from "../../src/ui/table-model";
import { bidding, call, DEAL, play, playing } from "./bridge-fixtures";
import {
	BOARD,
	LED,
	playableCards,
	queued,
	refused,
	seatView,
	shownCards,
	TABLE_ID,
	tableState,
	view,
} from "./table-model-fixtures";

describe("this seat's table actions", () => {
	it("offers nothing more while the seat's last action waits for the host", () => {
		const pending = queued(
			"local-1",
			actionPayload(TABLE_ID, BOARD, call("1S")),
		);
		const table = view("N", BOARD, { outbox: [pending] });
		expect(table.bids).toEqual([]);
		expect(table.actions).toEqual([
			{ id: "local-1", text: "Call 1♠", state: "pending" },
		]);

		const sent = queued(
			"local-2",
			actionPayload(TABLE_ID, LED, play("S2")),
			"sent",
		);
		const busy = view("N", LED, { outbox: [sent] });
		expect(playableCards(seatView(busy, "S").hand)).toEqual([]);
		expect(busy.actions).toEqual([
			{ id: "local-2", text: "Play ♠2", state: "sending" },
		]);
	});

	it("shows the host's reason while an action waits for an absent player", () => {
		const waiting: OutboxItem = {
			...queued("local-1", actionPayload(TABLE_ID, BOARD, call("1S"))),
			waiting: "Waiting for East to come back",
		};
		expect(view("N", BOARD, { outbox: [waiting] }).actions).toEqual([
			{
				id: "local-1",
				text: "Call 1♠",
				state: "pending",
				reason: "Waiting for East to come back",
			},
		]);
	});

	it("shows why the host refused an action, and lets the seat act again", () => {
		const reason = "the table has moved on since this action was chosen";
		const table = view("N", BOARD, {
			failures: [
				refused("c-1", actionPayload(TABLE_ID, BOARD, call("1S")), reason),
			],
		});
		expect(table.actions).toEqual([
			{ id: "c-1", text: "Call 1♠", state: "not-accepted", reason },
		]);
		expect(table.bids).not.toEqual([]);
	});

	it("shows an action that a host change undid", () => {
		const undone: Entry = {
			seq: 3,
			auth: { term: 1, tag: "holder-W", inc: 1 },
			prevAuth: { term: 1, tag: "holder-W", inc: 1 },
			id: "c-2",
			seat: "N",
			gen: 1,
			kind: "cmd",
			payload: actionPayload(TABLE_ID, BOARD, call("1S")),
			event: {},
		};
		expect(view("N", BOARD, { undone: [undone] }).actions).toEqual([
			{ id: "c-2", text: "Call 1♠", state: "undone" },
		]);
	});

	it("drops a deal that lost the race to another seat's deal, and actions of an earlier board", () => {
		const table = view("N", createBoard(2, DEAL), {
			failures: [
				refused("d-2", dealPayload(TABLE_ID, 2), "board 2 is already dealt"),
				refused(
					"c-1",
					actionPayload(TABLE_ID, BOARD, call("1S")),
					"it is not your turn",
				),
			],
		});
		expect(table.actions).toEqual([]);
	});

	it("offers nothing to a tab that can no longer act", () => {
		const table = view("N", BOARD, { terminal: true });
		expect(table.bids).toEqual([]);
		expect(view("N", null, { terminal: true }).nextBoard?.ready).toBe(false);
	});

	it("does not let a human act while the host bot controls their seat", () => {
		const table = view("N", BOARD, { bots: new Set(["N"]) });
		expect(table.bids).toEqual([]);
		expect(table.yourTurn).toBe(false);
	});
});

describe("the connection room before the first deal", () => {
	const WEST_HOSTS: RosterRow[] = [
		{
			seat: "W",
			label: SEAT_NAMES.W,
			host: true,
			you: false,
			state: "online",
			releasable: false,
		},
		{
			seat: "N",
			label: SEAT_NAMES.N,
			host: false,
			you: true,
			state: "online",
			releasable: false,
		},
	];

	it("shows joined seats with backs, the viewer's own seat too, free seats as not joined, and the host tag", () => {
		const table = view("N", null, {
			roster: WEST_HOSTS,
			hostSeat: "W",
			present: new Set<Seat>(["W"]),
		});
		expect(table.phase).toBe("waiting");
		expect(seatView(table, "W")).toMatchObject({
			presence: "online",
			tags: ["Host"],
			connecting: false,
			hand: { visible: false, count: 13 },
		});
		expect(seatView(table, "E")).toMatchObject({
			presence: "free",
			label: SEAT_NAMES.E,
			hand: { visible: false, count: 0 },
		});
		expect(seatView(table, "N")).toMatchObject({
			connecting: false,
			hand: { visible: false, count: 13 },
		});
	});

	it("keeps the first deal ready while the host's seat is bot controlled", () => {
		const table = view("W", null, {
			bots: new Set(["N", "E", "S", "W"]),
		});
		expect(table.nextBoard?.ready).toBe(true);
	});

	it("shows the viewer's own backs and the connecting banner until the host connects", () => {
		const table = view("N", null, {
			roster: WEST_HOSTS,
			hostSeat: "W",
			present: new Set<Seat>(),
		});
		expect(seatView(table, "N")).toMatchObject({
			connecting: true,
			hand: { visible: false, count: 13 },
		});
	});

	it("never shows the connecting banner to the host itself", () => {
		const table = view("W", null, {
			roster: WEST_HOSTS,
			hostSeat: "W",
			present: new Set<Seat>(),
		});
		expect(seatView(table, "W")).toMatchObject({ connecting: false });
	});
});

describe("dealing and scores", () => {
	it("requests the next board once after the countdown reaches zero", () => {
		const next = { board: 2, ready: true };
		expect(autoDealBoard(true, 1, 0, next, undefined)).toBe(2);
		expect(autoDealBoard(true, 1, 0, next, 2)).toBeUndefined();
		expect(autoDealBoard(true, 1, 1, next, undefined)).toBeUndefined();
		expect(
			autoDealBoard(true, 1, 0, { ...next, ready: false }, undefined),
		).toBeUndefined();
		expect(autoDealBoard(false, 1, 0, next, undefined)).toBeUndefined();
	});

	it("shows the compact score from the viewer's partnership", () => {
		const board = bidding(BOARD, "1S P P P");
		const done = playing(
			board,
			"S7 S2 H3 SA SK S6 S3 H2 SQ S5 S4 D2 SJ HJ H4 D3 ST HT H5 D4 S9 H9 H6 D5 S8 H8 D6 C2 HA H7 D7 C3 HK DT D8 C4 HQ DJ D9 C5 DA DQ CT C6 DK CK CJ C7 CA CQ C9 C8",
		);
		expect(view("S", done).scoring).toMatchObject({
			contract: { level: 1, strain: "S", doubling: "" },
			compactOutcome: "WON",
			compactDetail: "Made: 1♠ + 6",
		});
		expect(view("W", done).scoring).toMatchObject({
			compactOutcome: "LOST",
			compactDetail: "Opponents made: 1♠ + 6",
		});
		const exactlyMade = {
			...tableState(done),
			results: tableState(done).results.map((result) => ({
				...result,
				declarerTricks: 7,
			})),
		};
		expect(view("S", done, { state: exactlyMade }).scoring?.compactDetail).toBe(
			"Made: 1♠",
		);
		expect(view("W", done, { state: exactlyMade }).scoring?.compactDetail).toBe(
			"Opponents made: 1♠",
		);
		const doubledNoTrump = {
			...tableState(done),
			results: tableState(done).results.map((result) => ({
				...result,
				contract: result.contract && {
					...result.contract,
					level: 3 as const,
					strain: "NT" as const,
					doubling: "XX" as const,
				},
				declarerTricks: 10,
			})),
		};
		expect(
			view("S", done, { state: doubledNoTrump }).scoring?.compactDetail,
		).toBe("Made: 3NTXX + 1");
		const defendersWon = {
			...tableState(done),
			results: tableState(done).results.map((result) => ({
				...result,
				declarerTricks: 6,
			})),
		};
		expect(view("W", done, { state: defendersWon }).scoring).toMatchObject({
			compactOutcome: "WON",
			compactDetail: "Opponents down 1",
		});
	});

	it("marks the first board ready for the host when all seats are present", () => {
		const table = view("E", null);
		expect(table.phase).toBe("waiting");
		expect(table.at).toBe(0);
		expect(table.prompt).toBe("The first board is dealt now.");
		expect(table.nextBoard).toEqual({
			board: 1,
			ready: true,
		});
		expect(table.heading).toBe("ROOM CONNECTION");
	});

	it("marks the sequential next board ready after a board ends", () => {
		const passedOut = bidding(BOARD, "P P P P");
		expect(view("N", passedOut).nextBoard).toEqual({
			board: 2,
			ready: true,
		});
	});

	it("marks the board not ready while a host deal command is pending", () => {
		const own = queued("local-1", dealPayload(TABLE_ID, 1));
		const table = view("N", null, {
			hostSeat: "N",
			outbox: [own],
		});
		expect(table.nextBoard?.ready).toBe(false);
		expect(table.actions).toEqual([
			{ id: "local-1", text: "Deal board 1", state: "pending" },
		]);
	});

	it("shows the result, the score rows, the totals and the next deal when the board is over", () => {
		const board = bidding(BOARD, "1S P P P");
		const done = playing(
			board,
			"S7 S2 H3 SA SK S6 S3 H2 SQ S5 S4 D2 SJ HJ H4 D3 ST HT H5 D4 S9 H9 H6 D5 S8 H8 D6 C2 HA H7 D7 C3 HK DT D8 C4 HQ DJ D9 C5 DA DQ CT C6 DK CK CJ C7 CA CQ C9 C8",
		);
		const table = view("S", done);
		expect(table.phase).toBe("complete");
		expect(table.scoring).toEqual({
			contract: { level: 1, strain: "S", doubling: "", declarer: "N" },
			compactOutcome: "WON",
			compactDetail: "Made: 1♠ + 6",
			countdown: 10,
		});
		expect(table.scores).toEqual([
			{
				number: 1,
				contract: "1♠",
				declarer: "N",
				outcome: "+6",
				ns: "260",
				ew: "",
			},
		]);
		expect(table.totals).toEqual({ ns: 260, ew: 0 });
		expect(table.nextBoard).toEqual({
			board: 2,
			ready: true,
		});
		expect(shownCards(seatView(table, "W").hand)).toHaveLength(13);
		expect(
			(["N", "E", "S", "W"] as const).map((seat) => {
				const cards = seatView(table, seat).pointCards;
				return cards && countHandPoints("hcp", cards)?.raw;
			}),
		).toEqual([30, 9, 1, 0]);
		expect(seatView(view("S", playing(board, "S7")), "S").pointCards).toBe(
			undefined,
		);
	});

	it("reports a table that is loading or holds no bridge table", () => {
		expect(view("N", null, { state: undefined }).phase).toBe("loading");
		expect(view("N", null, { state: null }).phase).toBe("unreadable");
	});
});
