import { describe, expect, it } from "vitest";
import {
	applyAction,
	type Board,
	boardStatus,
	createBoard,
	legalActions,
	scoreBoard,
} from "../../src/bridge/engine";
import { countHandPoints } from "../../src/bridge/hand-points";
import {
	actionPayload,
	type BridgeState,
	dealPayload,
} from "../../src/game/bridge";
import { translator } from "../../src/i18n";
import type { OutboxItem } from "../../src/p2p/outbox";
import type { CommandFailure } from "../../src/p2p/table";
import type { Entry } from "../../src/p2p/wire";
import {
	type JsonObject,
	type RoomConfig,
	SEAT_NAMES,
	SEATS,
	type Seat,
} from "../../src/protocol";
import type { RosterRow } from "../../src/ui/model";
import {
	autoDealBoard,
	callText,
	cardText,
	commandText,
	type HandDisplay,
	positionOf,
	type TableView,
	type TableViewInput,
	tableView,
} from "../../src/ui/table-model";
import { bidding, call, DEAL, play, playing } from "./bridge-fixtures";

const TABLE_ID = "Table_ID-0123456789abc";
const CONFIG: RoomConfig = {
	names: { N: "player1", E: "player3", S: "player2", W: "player4" },
	scoring: "duplicate",
};
const ALL = new Set<Seat>(["N", "E", "S", "W"]);
const ROSTER: RosterRow[] = (["N", "E", "S", "W"] as const).map((seat) => ({
	seat,
	label: SEAT_NAMES[seat],
	host: seat === "N",
	you: seat === "N",
	state: "online",
	releasable: false,
}));

function tableState(board: Board | null): BridgeState {
	const result = board && scoreBoard(board);
	const earlier = board ? board.number - 1 : 0;
	const results = Array.from({ length: earlier }, (_, i) => ({
		number: i + 1,
		contract: null,
		declarerTricks: 0,
		scoreNS: 0,
	}));
	return {
		v: 1,
		roomId: TABLE_ID,
		game: "bridge",
		messages: 0,
		board,
		results: result ? [...results, result] : results,
		undo: null,
		claim: null,
		claimResult: null,
		media: {},
		systems: {},
	};
}

function view(
	seat: Seat,
	board: Board | null,
	overrides: Partial<TableViewInput> = {},
): TableView {
	return tableView({
		config: CONFIG,
		seat,
		state: tableState(board),
		terminal: false,
		present: ALL,
		roster: ROSTER,
		hostSeat: "N",
		outbox: [],
		failures: [],
		undone: [],
		...overrides,
	});
}

function queued(
	id: string,
	payload: JsonObject,
	state: OutboxItem["state"] = "queued",
): OutboxItem {
	return { id, payload, order: 1, state };
}

function refused(
	id: string,
	payload: JsonObject,
	reason: string,
): CommandFailure {
	return { id, payload, status: "rejected", reason };
}

function seatView(table: TableView, seat: Seat) {
	const found = table.seats.find((item) => item.seat === seat);
	if (!found) throw new Error(`no seat ${seat}`);
	return found;
}

function shownCards(hand: HandDisplay): string[] {
	return hand.visible
		? hand.suits.flatMap((row) => row.cards.map((c) => c.card))
		: [];
}

function playableCards(hand: HandDisplay): string[] {
	return hand.visible
		? hand.suits.flatMap((row) =>
				row.cards.filter((c) => c.playable).map((c) => c.card),
			)
		: [];
}

const BOARD = createBoard(1, DEAL);
/** 1♠ by North; East has led the ♠7, so declarer plays next from dummy (South). */
const LED = playing(bidding(BOARD, "1S P P P"), "S7");
const NORTH_DECLARER_BOARD = bidding(BOARD, "1C P P P");

it("keeps the final auction visible with no playable cards or turn prompt during its pause", () => {
	const held = view("E", NORTH_DECLARER_BOARD, { auctionPauseSeconds: 3 });
	const ready = view("E", NORTH_DECLARER_BOARD, { auctionPauseSeconds: 0 });
	const paused = view("E", NORTH_DECLARER_BOARD, { auctionPauseSeconds: 1 });
	for (const model of [held, paused]) {
		expect(model.phase).toBe("auction");
		expect(model.auction).toEqual(ready.auction);
		expect(model.yourTurn).toBe(false);
		expect(model.bids).toEqual([]);
		expect(model.seats.every((player) => player.turnPill === undefined)).toBe(
			true,
		);
		for (const player of model.seats)
			if (player.hand.visible)
				expect(
					player.hand.suits
						.flatMap((suit) => suit.cards)
						.every((card) => !card.playable),
				).toBe(true);
	}
	expect(held.prompt).toBe("Play starts in 3 seconds.");
	expect(ready.phase).toBe("play");
	expect(ready.yourTurn).toBe(true);
});
const NORTH_DUMMY_TURN = playing(NORTH_DECLARER_BOARD, "S7");
const NORTH_OWN_TURN = playing(NORTH_DECLARER_BOARD, "S7 S4 H3");

/** Plays the first legal card until `count` tricks are complete. */
function afterTricks(board: Board, count: number): Board {
	let current = board;
	while (boardStatus(current).tricks.length < count) {
		const seat = boardStatus(current).actor;
		const [action] = seat === undefined ? [] : legalActions(current, seat);
		if (seat === undefined || !action) throw new Error("nobody can play");
		const result = applyAction(current, seat, action);
		if (!result.ok) throw new Error(result.reason);
		current = result.board;
	}
	return current;
}

describe("text", () => {
	it("writes cards, calls and commands as players read them", () => {
		expect(cardText("ST")).toBe("♠10");
		expect(cardText("DQ")).toBe("♦Q");
		expect(
			["P", "X", "XX", "1S", "3NT"].map((c) => callText(c as never)),
		).toEqual(["Pass", "Double", "Redouble", "1♠", "3NT"]);
		expect(commandText(dealPayload(TABLE_ID, 2))).toBe("Deal board 2");
		expect(commandText(actionPayload(TABLE_ID, BOARD, call("XX")))).toBe(
			"Call Redouble",
		);
		expect(commandText(actionPayload(TABLE_ID, LED, play("S2")))).toBe(
			"Play ♠2",
		);
	});
});

describe("table layout", () => {
	it("enables claims for the declarer at every turn of the play, and for nobody else", () => {
		// West, a defender, is to play the third card of the first trick.
		const westTurn = playing(NORTH_DECLARER_BOARD, "S7 S4");
		expect(boardStatus(westTurn).actor).toBe("W");
		expect(view("N", bidding(BOARD, "1C P P")).claim.canRequest).toBe(false);
		for (const board of [
			NORTH_DECLARER_BOARD,
			NORTH_DUMMY_TURN,
			westTurn,
			NORTH_OWN_TURN,
		]) {
			expect(view("N", board).claim.canRequest).toBe(true);
			for (const seat of ["E", "S", "W"] as const)
				expect(view(seat, board).claim.canRequest).toBe(false);
		}
		// The trick in progress is one of the tricks to claim.
		expect(view("N", westTurn).claim.maxTricks).toBe(13);
	});

	it("lets a player ask to undo their last action while another player is to act", () => {
		expect(view("N", bidding(BOARD, "1C")).undo.canRequest).toBe(true);
		expect(view("E", LED).undo.canRequest).toBe(true);
		// The declarer played dummy's card; a defender is to play.
		expect(
			view("N", playing(NORTH_DECLARER_BOARD, "S7 S4")).undo.canRequest,
		).toBe(true);
	});

	it("offers the trick count choice only when five tricks or fewer remain", () => {
		const six = afterTricks(NORTH_DECLARER_BOARD, 7);
		const five = afterTricks(NORTH_DECLARER_BOARD, 8);
		expect(view("N", six).claim).toMatchObject({
			maxTricks: 6,
			choosable: false,
		});
		expect(view("N", five).claim).toMatchObject({
			maxTricks: 5,
			choosable: true,
		});
		// The other seats see the choice too, but only the declarer can use it.
		expect(view("E", five).claim).toMatchObject({
			canRequest: false,
			choosable: true,
		});
		expect(view("N", NORTH_DECLARER_BOARD).claim.choosable).toBe(false);
	});

	it("asks each player who must decide an undo or a claim, and tells the other players who must decide", () => {
		const undoOf = (board: Board, calls: number, cards: number) => ({
			state: {
				...tableState(board),
				undo: {
					id: "undo-1",
					board: 1,
					requester: "N" as const,
					required: ["E", "S", "W"] as const,
					approved: [],
					calls,
					cards,
				},
			},
		});
		const auctionUndo = undoOf(bidding(BOARD, "1C"), 0, 0);
		expect(view("E", BOARD, auctionUndo).undo).toMatchObject({
			canVote: true,
			message: "player1 asks to undo their last bid. Do you approve?",
		});
		const playUndo = undoOf(NORTH_OWN_TURN, 4, 2);
		expect(view("W", BOARD, playUndo).undo).toMatchObject({
			canVote: true,
			message: "player1 asks to undo their last played card. Do you approve?",
		});
		const claim = {
			state: {
				...tableState(NORTH_OWN_TURN),
				claim: {
					id: "claim-1",
					board: 1,
					requester: "N" as const,
					tricks: 3,
					required: ["E", "W"] as const,
					approved: ["W"] as const,
				},
			},
		};
		expect(view("E", BOARD, claim).claim).toMatchObject({
			canVote: true,
			message: "player1 claims 3 tricks. Do you accept the claim?",
		});
		// Dummy does not decide a claim.
		expect(view("S", BOARD, claim).claim).toMatchObject({
			canVote: false,
			message: "player1 claims 3 tricks. Waiting for player3 to decide.",
		});
	});

	it("shows every hand to the defenders while a claim waits, and to the declarer and dummy once it is accepted", () => {
		const claim = {
			id: "claim-1",
			board: 1,
			requester: "N" as const,
			tricks: 3,
			required: ["E", "W"] as const,
			approved: [],
		};
		const pending = { state: { ...tableState(NORTH_OWN_TURN), claim } };
		const visibleSeats = (viewer: Seat, overrides: Partial<TableViewInput>) =>
			view(viewer, BOARD, overrides)
				.seats.filter((item) => item.hand.visible)
				.map((item) => item.seat)
				.sort();
		for (const defender of ["E", "W"] as const)
			expect(visibleSeats(defender, pending)).toEqual(["E", "N", "S", "W"]);
		for (const side of ["N", "S"] as const)
			expect(visibleSeats(side, pending)).toEqual(["N", "S"]);

		// The result is display data here; its score does not decide which hands are shown.
		const result = {
			number: 1,
			contract: boardStatus(NORTH_OWN_TURN).contract ?? null,
			declarerTricks: 3,
			scoreNS: -200,
		};
		const accepted = {
			state: {
				...tableState(NORTH_OWN_TURN),
				results: [result],
				claimResult: { ...claim, result },
			},
		};
		for (const seat of SEATS)
			expect(visibleSeats(seat, accepted)).toEqual(["E", "N", "S", "W"]);
	});

	it("puts the turn pill on the seat to call or play, and marks it as the viewer's when the viewer acts", () => {
		const pills = (table: TableView) =>
			Object.fromEntries(
				table.seats.flatMap((item) =>
					item.turnPill ? [[item.seat, item.turnPill]] : [],
				),
			);
		expect(pills(view("N", BOARD))).toEqual({
			N: { action: "bid", yours: true },
		});
		expect(pills(view("E", BOARD))).toEqual({
			N: { action: "bid", yours: false },
		});
		// Dummy's turn: the pill is on dummy (South), and declarer North plays its card.
		expect(pills(view("N", NORTH_DUMMY_TURN))).toEqual({
			S: { action: "play", yours: true },
		});
		expect(pills(view("S", NORTH_DUMMY_TURN))).toEqual({
			S: { action: "play", yours: false },
		});
		expect(pills(view("N", NORTH_OWN_TURN))).toEqual({
			N: { action: "play", yours: true },
		});
		expect(pills(view("W", NORTH_OWN_TURN))).toEqual({
			N: { action: "play", yours: false },
		});
		expect(pills(view("N", bidding(BOARD, "P P P P")))).toEqual({});
	});

	it("puts the viewer at the bottom and the others clockwise: left, top, right", () => {
		expect(
			(["S", "W", "N", "E"] as Seat[]).map((s) => positionOf("S", s)),
		).toEqual(["bottom", "left", "top", "right"]);
		expect(positionOf("W", "N")).toBe("left");
		expect(positionOf("W", "S")).toBe("right");
	});

	it("shows only the viewer's own hand in the auction, sorted into suit rows", () => {
		const table = view("E", BOARD);
		expect(table.phase).toBe("auction");
		expect(table.heading).toBe("AUCTION");
		expect(table.details).toBe("Dealer: North");
		expect(table.vulnerability).toEqual([
			{
				side: "ns",
				text: "N-S not vulnerable",
				status: "not vulnerable",
				vulnerable: false,
			},
			{
				side: "ew",
				text: "E-W not vulnerable",
				status: "not vulnerable",
				vulnerable: false,
			},
		]);
		const own = seatView(table, "E");
		expect(own.tags).toEqual([]);
		expect(own.position).toBe("bottom");
		expect(own.hand.visible && own.hand.suits.map((row) => row.symbol)).toEqual(
			["♠", "♥", "♦", "♣"],
		);
		expect(
			own.hand.visible &&
				own.hand.suits
					.find((row) => row.symbol === "♠")
					?.cards.map((c) => c.rank),
		).toEqual(["7", "6", "5"]);
		expect(seatView(table, "N")).toMatchObject({
			tags: ["Host"],
			turn: true,
			hand: { visible: false, count: 13 },
		});
	});
});

describe("auction", () => {
	it("offers the legal calls only to the seat whose turn it is", () => {
		const north = view("N", bidding(BOARD, ""));
		expect(north.prompt).toBe("North to bid");
		expect(north.bids.map((bid) => bid.call)).not.toContain("X");
		expect(north.bids[0]).toEqual({ call: "P", text: "Pass" });
		expect(north.bids).toHaveLength(36);
		const east = view("E", BOARD);
		expect(east.bids).toEqual([]);
		expect(east.prompt).toBe("North to bid");
	});

	it("lines up the calls under their seats, starting at the dealer", () => {
		const board2 = bidding(createBoard(2, DEAL), "1C X P");
		const table = view("N", board2);
		expect(table.details).toBe("Dealer: East");
		expect(table.vulnerability).toEqual([
			{
				side: "ns",
				text: "N-S vulnerable",
				status: "vulnerable",
				vulnerable: true,
			},
			{
				side: "ew",
				text: "E-W not vulnerable",
				status: "not vulnerable",
				vulnerable: false,
			},
		]);
		expect(table.auction).toEqual({
			seats: ["N", "E", "S", "W"],
			rows: [["—", "1♣", "Double", "Pass"]],
			systems: [undefined, undefined, undefined, undefined],
			bots: [],
			calls: ["1C", "X", "P"],
			meanings: [[undefined, undefined, undefined, undefined]],
		});
	});

	it("marks the seats before a South dealer with a dash and leaves calls to come out", () => {
		const board3 = bidding(createBoard(3, DEAL), "1H P P P");
		expect(view("N", board3).auction?.rows).toEqual([
			["—", "—", "1♥", "Pass"],
			["Pass", "Pass"],
		]);
	});

	it("names each seat's bidding system and assumes corrected HCP for a bot seat", () => {
		const state = {
			...tableState(bidding(BOARD, "1C")),
			systems: { N: "vienna", E: "other", W: "reith" },
		} as const;
		const auction = view("S", null, {
			state,
			bots: new Set<Seat>(["W"]),
		}).auction;
		expect(auction?.systems).toEqual([
			"vienna",
			"other",
			undefined,
			"hcp-corrected",
		]);
		expect(auction?.bots).toEqual(["W"]);
	});

	it("explains each described call by its caller's system, in the cell of the call", () => {
		const state = {
			...tableState(bidding(createBoard(2, DEAL), "1NT P 2C P")),
			systems: { E: "hcp", W: "hcp-corrected" },
		} as const;
		const auction = view("N", null, {
			state,
		}).auction;
		expect(auction?.rows).toEqual([["—", "1NT", "Pass", "2♣"], ["Pass"]]);
		expect(auction?.meanings).toEqual([
			[
				undefined,
				"15–17 HCP, balanced",
				undefined,
				"8+ corrected HCP, Stayman, a 4-card major",
			],
			[undefined],
		]);
		// A bot's call reads by corrected HCP, whatever system an earlier player of its seat sent.
		expect(
			view("N", null, { state, bots: new Set<Seat>(["E"]) }).auction
				?.meanings[0]?.[1],
		).toBe("15–17 corrected HCP, balanced");
	});

	it("explains an overcall, marks a call that the guide does not describe, and gives no meaning to a scale with only a guide", () => {
		const state = {
			...tableState(bidding(BOARD, "1C 1H X P")),
			systems: { N: "vienna", E: "hcp", S: "hcp", W: "other" },
		} as const;
		expect(view("E", null, { state }).auction?.meanings).toEqual([
			[
				undefined,
				"8–16 HCP, a good 5+ card ♥ suit",
				"not in the guide",
				undefined,
			],
		]);
	});

	it("explains a pass where the guide gives it to the hands that fit no other call", () => {
		const state = {
			...tableState(bidding(BOARD, "1H P")),
			systems: { N: "hcp", E: "hcp" },
		} as const;
		expect(view("S", null, { state }).auction?.meanings).toEqual([
			["12–21 HCP, 5+ ♥", "no other guide call fits"],
		]);
	});

	it("explains opener's re-raise as a game try, and after an opponent's call as competitive", () => {
		const state = (auction: string) =>
			({
				...tableState(bidding(BOARD, auction)),
				systems: { N: "hcp-corrected", E: "hcp", S: "hcp", W: "hcp" },
			}) as const;
		expect(
			view("E", null, { state: state("1H P 2H P 3H") }).auction?.meanings[1],
		).toEqual(["15–17 corrected HCP, game try, invites game, 5+ ♥"]);
		expect(
			view("E", null, { state: state("1H P 2H 2S 3H") }).auction?.meanings[1],
		).toEqual(["12–17 corrected HCP, competitive, no game invitation, 6+ ♥"]);
	});

	it("explains Blackwood with the slam targets of the caller's system", () => {
		const state = {
			...tableState(bidding(BOARD, "1H P 3H P 4NT")),
			systems: { N: "hcp-corrected", E: "hcp", S: "hcp-corrected", W: "hcp" },
		} as const;
		expect(view("E", null, { state }).auction?.meanings[1]).toEqual([
			"Blackwood, asks for aces: a small slam needs about 33+ corrected HCP together, a grand slam about 37+ corrected HCP",
		]);
	});

	it.each(["vienna", "reith", "four-aces"] as const)(
		"gives no meanings to the calls of the %s scale, which has only its guide",
		(system) => {
			const state = {
				...tableState(bidding(BOARD, "P 2S P 4NT")),
				systems: { N: system, E: system, S: system, W: system },
			} as const;
			expect(view("S", null, { state }).auction?.meanings).toEqual([
				[undefined, undefined, undefined, undefined],
			]);
		},
	);
});

describe("play", () => {
	it("keeps the West declarer's thirteen cards through the opponents' opening lead", () => {
		const board = playing(bidding(createBoard(3, DEAL), "P 2S P P P"), "SA S7");
		const table = view("W", board);

		expect(table.header?.declarer).toBe("W");
		expect(table.trick?.cards.map((item) => item.seat)).toEqual(["N", "E"]);
		expect(shownCards(seatView(table, "W").hand)).toHaveLength(13);
		expect(table.need?.remaining).toBe(13);
	});

	it.each(["S7", "S7 S2 C2"])(
		"lets human dummy choose both hands when declarer is a robot after %s",
		(cards) => {
			const board = playing(bidding(createBoard(1, DEAL), "1S P P P"), cards);
			const south = view("S", board, { bots: new Set(["N"]) });
			expect(south.yourTurn).toBe(true);
			expect(south.seats.find((seat) => seat.turn)?.turnPill?.yours).toBe(true);
			const playable = south.seats.flatMap((seat) =>
				seat.hand.visible
					? seat.hand.suits.flatMap((suit) =>
							suit.cards.filter((card) => card.playable),
						)
					: [],
			);
			expect(playable.map((card) => card.card)).toEqual(
				legalActions(board, "N").flatMap((action) =>
					action.type === "play" ? [action.card] : [],
				),
			);
			expect(view("S", board, { bots: new Set(["N", "S"]) }).yourTurn).toBe(
				false,
			);
			expect(
				view("S", board, {
					bots: new Set(["N"]),
					autoplaySeats: new Set(["N"]),
				}).yourTurn,
			).toBe(false);
		},
	);

	it("lets declarer play from dummy, and shows dummy to everyone after the lead", () => {
		const north = view("N", LED);
		expect(north.phase).toBe("play");
		expect(north.at).toBe(5);
		expect(north.prompt).toBe("Your turn: play a card from dummy.");
		expect(north.contract).toBe("1♠ by North");
		expect(playableCards(seatView(north, "S").hand)).toEqual([
			"S4",
			"S3",
			"S2",
		]);
		expect(playableCards(seatView(north, "N").hand)).toEqual([]);
		expect(seatView(north, "N").tags).toEqual(["Host", "Declarer"]);
		expect(seatView(north, "S").tags).toEqual(["Dummy"]);

		const south = view("S", LED);
		expect(south.prompt).toBe("Waiting for North to play from dummy.");
		expect(playableCards(seatView(south, "S").hand)).toEqual([]);
		expect(seatView(south, "N").position).toBe("top");
		expect(shownCards(seatView(south, "N").hand)).toHaveLength(13);
		expect(playableCards(seatView(south, "N").hand)).toEqual([]);
		const west = view("W", LED);
		expect(shownCards(seatView(west, "S").hand)).toHaveLength(13);
		// Dummy's trump suit, spades, is on dummy's own right: the top on the viewer's right, the bottom on the left.
		const symbols = (table: TableView) => {
			const hand = seatView(table, "S").hand;
			return hand.visible && hand.suits.map((row) => row.symbol);
		};
		expect(seatView(west, "S").position).toBe("right");
		expect(symbols(west)).toEqual(["♠", "♥", "♦", "♣"]);
		const east = view("E", LED);
		expect(seatView(east, "S").position).toBe("left");
		expect(symbols(east)).toEqual(["♥", "♦", "♣", "♠"]);
		expect(seatView(west, "N").hand).toEqual({ visible: false, count: 13 });
		expect(west.trick).toEqual({
			cards: [
				{
					seat: "E",
					position: "top",
					card: "S7",
					text: "♠7",
					rank: "7",
					symbol: "♠",
				},
			],
			finished: false,
		});
	});

	it("shows the last trick and its winner until the next card is led", () => {
		const board = playing(LED, "S2 H3 SA");
		const table = view("E", board);
		expect(table.trick?.cards.map((c) => c.card)).toEqual([
			"S7",
			"S2",
			"H3",
			"SA",
		]);
		expect(table.trick?.finished).toBe(true);
		expect(table.tricks).toBe("Tricks: N-S 1 · E-W 0");
		expect(table.prompt).toBe("Waiting for North to play.");
	});
});

describe("presence (plan §12 R4)", () => {
	it("marks bot seats from the shared roster", () => {
		const table = view("N", null, { bots: new Set<Seat>(["E", "W"]) });
		expect(seatView(table, "E").bot).toBe(true);
		expect(seatView(table, "E").label).toContain("🤖");
		expect(seatView(table, "W").bot).toBe(true);
		expect(seatView(table, "N").bot).toBe(false);
	});

	const without = (...absent: Seat[]) =>
		new Set([...ALL].filter((seat) => !absent.includes(seat)));

	it("waits for every seat before a deal, and names the absent seats", () => {
		const table = view("E", null, { present: without("N", "W") });
		expect(table.nextBoard?.ready).toBe(false);
		expect(table.prompt).toBe(
			"Waiting for player1 (N) and player4 (W) to come back",
		);
	});

	it("lets the seat to bid bid while the others are away, and waits only while that seat is away", () => {
		const north = view("N", BOARD, { present: new Set<Seat>(["N"]) });
		expect(north.bids).not.toEqual([]);
		expect(north.prompt).toBe("North to bid");
		const east = view("E", BOARD, { present: without("N") });
		expect(east.prompt).toBe("Waiting for player1 (N) to come back");
	});

	it("lets declarer play from dummy while dummy and a defender are away", () => {
		const away = view("N", LED, { present: without("S", "W") });
		expect(away.prompt).toBe("Your turn: play a card from dummy.");
		expect(playableCards(seatView(away, "S").hand)).toEqual(["S4", "S3", "S2"]);
		const declarerAway = view("E", LED, { present: without("N") });
		expect(declarerAway.prompt).toBe("Waiting for player1 (N) to come back");
	});

	it("waits with the next board while dummy is away, and names dummy when the countdown ends", () => {
		const done = playing(
			bidding(BOARD, "1S P P P"),
			"S7 S2 H3 SA SK S6 S3 H2 SQ S5 S4 D2 SJ HJ H4 D3 ST HT H5 D4 S9 H9 H6 D5 S8 H8 D6 C2 HA H7 D7 C3 HK DT D8 C4 HQ DJ D9 C5 DA DQ CT C6 DK CK CJ C7 CA CQ C9 C8",
		);
		const counting = view("N", done, { present: without("S") });
		expect(counting.nextBoard?.ready).toBe(false);
		expect(counting.prompt).toBe("");
		expect(counting.waiting).toBe("");
		const ended = view("N", done, {
			present: without("S"),
			scoringCountdown: 0,
		});
		expect(ended.waiting).toBe("Waiting for player2 (S) to come back");
		expect(view("N", done, { scoringCountdown: 0 }).nextBoard?.ready).toBe(
			true,
		);
	});

	it("names the absent seat to act for the waiting overlay, and nobody else", () => {
		expect(view("E", null, { present: without("N") }).waiting).toBe("");
		expect(view("N", BOARD, { present: without("S") }).waiting).toBe("");
		expect(view("E", BOARD, { present: without("N") }).waiting).toBe(
			"Waiting for player1 (N) to come back",
		);
		expect(view("N", BOARD).waiting).toBe("");
		expect(view("N", LED, { present: without("S", "W") }).waiting).toBe("");
		expect(view("W", LED, { present: without("N") }).waiting).toBe(
			"Waiting for player1 (N) to come back",
		);
	});

	it("names a seat without a player by its direction", () => {
		const config = { ...CONFIG, names: { ...CONFIG.names, W: "" } };
		expect(view("E", null, { config, present: without("N", "W") }).prompt).toBe(
			"Waiting for player1 (N) and West to come back",
		);
	});
});

describe("the viewer's language", () => {
	const hu = { t: translator("hu") };

	it("names the seat to bid and the seat to play in Hungarian", () => {
		const east = view("E", BOARD, hu);
		expect(east.prompt).toBe("Észak licitál");
		expect(east.waiting).toBe("");
		expect(view("N", LED, hu).prompt).toBe(
			"Te következel: játssz ki egy lapot az asztalról.",
		);
		expect(view("S", LED, hu).prompt).toBe(
			"Várakozás: Észak játszik az asztalról.",
		);
		expect(view("E", NORTH_OWN_TURN, hu).prompt).toBe(
			"Várakozás: Észak játszik.",
		);
	});

	it("explains a call in Hungarian", () => {
		const state = {
			...tableState(bidding(createBoard(2, DEAL), "1NT")),
			systems: { E: "hcp" },
		} as const;
		expect(view("N", null, { ...hu, state }).auction?.meanings).toEqual([
			[undefined, "15–17 HCP, kiegyensúlyozott"],
		]);
	});

	it("names the dealer and the vulnerability of each side in Hungarian", () => {
		const board3 = view("N", createBoard(3, DEAL), hu);
		expect(board3.heading).toBe("LICITÁLÁS");
		expect(board3.details).toBe("Osztó: Dél");
		expect(board3.vulnerability).toEqual([
			{
				side: "ns",
				text: "É-D mansban",
				status: "mansban",
				vulnerable: false,
			},
			{
				side: "ew",
				text: "K-Ny bellben",
				status: "bellben",
				vulnerable: true,
			},
		]);
		expect(
			view("N", createBoard(4, DEAL), hu).vulnerability.map(
				(line) => line.text,
			),
		).toEqual(["É-D bellben", "K-Ny bellben"]);
	});

	it("writes the own turn to play, and the absent seats, in Hungarian", () => {
		const west = view("W", playing(NORTH_DECLARER_BOARD, "S7 S4"), hu);
		expect(west.prompt).toBe("Te következel.");
		expect(west.contract).toBe("1♣, felvevő: Észak");
		const away = view("E", BOARD, {
			...hu,
			present: new Set<Seat>(["E", "S"]),
		});
		expect(away.prompt).toBe("Várakozás, hogy visszatérjenek: player1 (É)");
		expect(away.waiting).toBe("Várakozás, hogy visszatérjenek: player1 (É)");
		expect(
			view("E", null, { ...hu, present: new Set<Seat>(["E", "S"]) }).prompt,
		).toBe("Várakozás, hogy visszatérjenek: player1 (É) és player4 (Ny)");
	});

	it("writes the loading and unreadable tables, the calls to confirm, and the sent call in Hungarian", () => {
		expect(view("N", null, { ...hu, state: undefined }).prompt).toBe(
			"Az asztal betöltése…",
		);
		expect(view("N", null, { ...hu, state: null }).prompt).toBe(
			"Ebben a szobában nincs bridzsasztal.",
		);
		const east = view("E", bidding(BOARD, "1C"), hu);
		expect(
			east.bids.filter((bid) => ["P", "X", "1NT"].includes(bid.call)),
		).toEqual([
			{ call: "P", text: "Passz" },
			{ call: "X", text: "Kontra" },
			{ call: "1NT", text: "1NT" },
		]);
		expect(commandText(actionPayload(TABLE_ID, BOARD, call("XX")), hu.t)).toBe(
			"Licit: Rekontra",
		);
	});
});

describe("round trips", () => {
	const measured = (ms: number) =>
		seatView(view("N", BOARD, { roundTrips: [{ seat: "E", ms }] }), "E")
			.roundTrip;

	it("names the network quality from the round trip shown in the hint, with two decimals", () => {
		expect(measured(100)).toEqual({
			text: "Network: excellent",
			title: "Roundtrip: 0.10sec",
			quality: "excellent",
		});
		// The quality follows the shown hundredths, so 0.104 s shows as "0.10sec" and is still excellent.
		expect(measured(104)?.quality).toBe("excellent");
		expect(measured(105)).toEqual({
			text: "Network: good",
			title: "Roundtrip: 0.11sec",
			quality: "good",
		});
		expect(measured(300)?.quality).toBe("good");
		expect(measured(305)).toEqual({
			text: "Network: average",
			title: "Roundtrip: 0.31sec",
			quality: "average",
		});
		expect(measured(600)?.quality).toBe("average");
		expect(measured(605)).toEqual({
			text: "Network: poor",
			title: "Roundtrip: 0.61sec",
			quality: "poor",
		});
		expect(measured(1234)?.title).toBe("Roundtrip: 1.23sec");
		// 1.994 s shows as "1.99sec" and is still poor; from 2.00 s the connection is breaking up.
		expect(measured(1994)?.quality).toBe("poor");
		expect(measured(1995)).toEqual({
			text: "Network: breaking up",
			title: "Roundtrip: 2.00sec",
			quality: "breaking-up",
		});
	});

	it("names an unanswered probe breaking up, and shows its lower bound with >", () => {
		const table = view("N", null, {
			roundTrips: [{ seat: "S", ms: 5000, lower: true }],
		});
		expect(seatView(table, "S").roundTrip).toEqual({
			text: "Network: breaking up",
			title: "Roundtrip: >5.00sec",
			quality: "breaking-up",
		});
	});

	it("shows the measuring state for a locally connected human, and hides self, bots and absent peers", () => {
		const absentWest = new Set<Seat>(["N", "E", "S"]);
		for (const board of [null, BOARD]) {
			const table = view("E", board, {
				present: absentWest,
				bots: new Set<Seat>(["S"]),
				roundTrips: [
					{ seat: "E", ms: 40 },
					{ seat: "S", ms: 30 },
					{ seat: "W", ms: 20 },
				],
			});
			expect(seatView(table, "E").roundTrip).toBeUndefined();
			// Even stale samples cannot show an indicator for self, a bot or a disconnected peer.
			expect(seatView(table, "S").roundTrip).toBeUndefined();
			expect(seatView(table, "W").roundTrip).toBeUndefined();
			expect(seatView(view("E", board), "W").roundTrip).toEqual({
				text: "Network: measuring…",
				quality: "pending",
			});
		}
	});

	it("shows only local measurements to other seats, without substituting a host measurement", () => {
		const roundTrips = [
			{ seat: "N", ms: 250 },
			{ seat: "E", ms: 40 },
			{ seat: "S", ms: 900 },
		] as const;
		for (const board of [null, BOARD]) {
			// East measured North and South independently. A stale self sample is never displayed.
			expect(seatView(view("E", board, { roundTrips }), "N").roundTrip).toEqual(
				{
					text: "Network: good",
					title: "Roundtrip: 0.25sec",
					quality: "good",
				},
			);
			expect(
				seatView(view("E", board, { roundTrips }), "S").roundTrip?.quality,
			).toBe("poor");
			expect(
				seatView(view("E", board, { roundTrips }), "E").roundTrip,
			).toBeUndefined();
			// Before the local page measured the host, and on the host's own page.
			expect(seatView(view("E", board), "N").roundTrip).toEqual({
				text: "Network: measuring…",
				quality: "pending",
			});
			expect(
				seatView(view("N", board, { roundTrips }), "N").roundTrip,
			).toBeUndefined();
		}
	});
});

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

	it("shows joined seats with backs, free seats as not joined, and the host tag", () => {
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
			hand: { visible: false, count: 0 },
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
			compactDetail: "Made +6",
		});
		expect(view("W", done).scoring).toMatchObject({
			compactOutcome: "LOST",
			compactDetail: "Opponents made +6",
		});
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
			compactDetail: "Made +6",
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
