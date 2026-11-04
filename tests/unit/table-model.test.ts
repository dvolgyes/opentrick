import { describe, expect, it } from "vitest";
import { type Board, boardStatus, createBoard } from "../../src/bridge/engine";
import { actionPayload, dealPayload } from "../../src/game/bridge";
import { SEATS, type Seat } from "../../src/protocol";
import {
	callText,
	cardText,
	commandText,
	positionOf,
	type TableView,
	type TableViewInput,
} from "../../src/ui/table-model";
import { bidding, call, DEAL, play, playing } from "./bridge-fixtures";
import {
	afterTricks,
	BOARD,
	LED,
	NORTH_DECLARER_BOARD,
	NORTH_DUMMY_TURN,
	NORTH_OWN_TURN,
	seatView,
	TABLE_ID,
	tableState,
	view,
} from "./table-model-fixtures";

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

it("names the contract, its declarer and the declaring side's vulnerability while play waits", () => {
	const north = view("E", NORTH_DECLARER_BOARD, { auctionPauseSeconds: 3 });
	expect(north.auctionEnd).toMatchObject({
		contract: { level: 1, strain: "C", doubling: "" },
		declarer: "by North",
		vulnerability: "N-S not vulnerable",
		vulnerable: false,
	});
	expect(north.prompt).toBe("Play starts in 3 seconds.");
	// Board 3: South deals and East-West are vulnerable; West opens 2♥ and the others pass.
	const west = view("N", bidding(createBoard(3, DEAL), "P 2H P P P"), {
		auctionPauseSeconds: 2,
	});
	expect(west.auctionEnd).toMatchObject({
		contract: { level: 2, strain: "H" },
		declarer: "by West",
		vulnerability: "E-W vulnerable",
		vulnerable: true,
	});
	expect(
		view("E", NORTH_DECLARER_BOARD, { auctionPauseSeconds: 0 }).auctionEnd,
	).toBeUndefined();
});

it("tells only the human who controls both declaring hands during the auction pause", () => {
	const held = { auctionPauseSeconds: 3 };
	expect(view("N", NORTH_DECLARER_BOARD, held).auctionEnd?.bothHands).toBe(
		"You will play both hands: North and South.",
	);
	expect(
		seatView(view("N", NORTH_DECLARER_BOARD, held), "S").hand.visible,
	).toBe(false);
	expect(
		view("S", NORTH_DECLARER_BOARD, { ...held, bots: new Set(["N"]) })
			.auctionEnd?.bothHands,
	).toBe("You will play both hands: North and South.");
	expect(
		view("E", NORTH_DECLARER_BOARD, held).auctionEnd?.bothHands,
	).toBeUndefined();
	expect(
		view("S", NORTH_DECLARER_BOARD, held).auctionEnd?.bothHands,
	).toBeUndefined();
	expect(
		view("N", NORTH_DECLARER_BOARD, {
			...held,
			bots: new Set(["N"]),
			autoplaySeats: new Set(["N"]),
		}).auctionEnd?.bothHands,
	).toBeUndefined();
	expect(view("N", bidding(BOARD, "P P P P"), held).auctionEnd).toBeUndefined();
});

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

	it("lets a defender undo their card when the declarer is a bot", () => {
		const defender = view("E", LED, { bots: new Set<Seat>(["N"]) });
		expect(defender.undo.canRequest).toBe(true);
		expect(defender.undo.question).toBe("Ask to undo your last played card?");
	});

	it("names the action that an undo request would take back, and nothing while no request can be sent", () => {
		expect(view("N", bidding(BOARD, "1C")).undo.question).toBe(
			"Ask to undo your last bid?",
		);
		expect(view("E", LED).undo.question).toBe(
			"Ask to undo your last played card?",
		);
		expect(view("E", bidding(BOARD, "1C")).undo).toMatchObject({
			canRequest: false,
			question: "",
		});
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
	it("uses each bid's recorded origin instead of the seat's current system or bot status", () => {
		const board = bidding(BOARD, "1NT P");
		const state = {
			...tableState(board),
			systems: { N: "vienna", E: "hcp" },
			bidHistory: [
				{ controller: "seat", system: "hcp" },
				{ controller: "bot" },
			],
		} as const;
		const auction = view("S", null, {
			state,
			bots: new Set<Seat>(["N"]),
		}).auction;
		expect(auction?.meanings[0]?.[0]).toBe("15–17 HCP, balanced");
		expect(auction?.meanings[0]?.[1]).toContain("Guide reference");
	});

	it("marks older calls with unknown origin as guide references", () => {
		const state = {
			...tableState(bidding(BOARD, "1NT")),
			systems: { N: "hcp" },
			bidHistory: [null],
		} as const;
		const auction = view("S", null, { state }).auction;
		expect(auction?.meanings[0]?.[0]).toContain("Guide reference");
	});

	it("uses the viewer's selected guide for bot bid references", () => {
		const state = {
			...tableState(bidding(BOARD, "1NT")),
			bidHistory: [{ controller: "bot" }],
		} as const;
		const corrected = view("S", null, {
			state,
			referenceSystem: "hcp-corrected",
		}).auction?.meanings[0]?.[0];
		const hcp = view("S", null, { state, referenceSystem: "hcp" }).auction
			?.meanings[0]?.[0];
		expect(corrected).toBe(
			"Guide reference (corrected HCP): 15–17 corrected HCP, balanced. This may not describe the bid.",
		);
		expect(hcp).toBe(
			"Guide reference (HCP): 15–17 HCP, balanced. This may not describe the bid.",
		);
	});

	it("does not show a previous holder's system under a replacement player's name", () => {
		const state = {
			...tableState(bidding(BOARD, "1NT")),
			systems: { N: "hcp" },
			systemHolders: { N: "previous" },
			bidHistory: [{ controller: "seat", system: "hcp" }],
		} as const;
		const changed = view("S", null, {
			state,
			holders: { N: "replacement" },
		}).auction;
		const same = view("S", null, { state, holders: { N: "previous" } }).auction;
		expect(changed?.systems[0]).toBeUndefined();
		expect(same?.systems[0]).toBe("hcp");
		expect(changed?.meanings[0]?.[0]).toBe("15–17 HCP, balanced");
	});
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
			meanings: [
				[
					undefined,
					"Guide reference (corrected HCP): 12–21 corrected HCP, 3+ ♣. This may not describe the bid.",
					"Guide reference (corrected HCP): 12+ corrected HCP, takeout, short in ♣, or 17+ corrected HCP. This may not describe the bid.",
					"Guide reference (corrected HCP): no other guide call fits. This may not describe the bid.",
				],
			],
		});
	});

	it("marks the seats before a South dealer with a dash and leaves calls to come out", () => {
		const board3 = bidding(createBoard(3, DEAL), "1H P P P");
		expect(view("N", board3).auction?.rows).toEqual([
			["—", "—", "1♥", "Pass"],
			["Pass", "Pass"],
		]);
	});

	it("names each seat's bidding system without assigning a guide system to a bot", () => {
		const state = {
			...tableState(bidding(BOARD, "1C")),
			systems: { N: "vienna", E: "other", W: "reith" },
		} as const;
		const auction = view("S", null, {
			state,
			bots: new Set<Seat>(["W"]),
		}).auction;
		expect(auction?.systems).toEqual(["vienna", "other", undefined, "other"]);
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
				"Guide reference (corrected HCP): not in the guide. This may not describe the bid.",
				"Stayman: a 4-card major with 8+ corrected HCP, or 4-4 in the majors and at most 1 ♣ with 0–7 corrected HCP",
			],
			[
				"Guide reference (corrected HCP): not in the guide. This may not describe the bid.",
			],
		]);
		// A later bot takeover does not rewrite the system recorded when East made this call.
		expect(
			view("N", null, { state, bots: new Set<Seat>(["E"]) }).auction
				?.meanings[0]?.[1],
		).toBe("15–17 HCP, balanced");
	});

	it("explains an overcall, marks a call that the guide does not describe, and gives no meaning to a scale with only a guide", () => {
		const state = {
			...tableState(bidding(BOARD, "1C 1H 1S P")),
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

	it.each([
		["1C 1H X", "6+ HCP, negative double, exactly 4 ♠"],
		["1C 1D X", "6+ HCP, negative double, exactly 4 ♠ and ♥"],
		["1D 1S X", "6+ HCP, negative double, 4 ♥, or 5 with 6–10 HCP"],
		["1D 2C X", "8+ HCP, negative double, 4 ♠ and ♥, or 5 with 6–10 HCP"],
	])("explains the negative double in %s", (auction, text) => {
		const state = {
			...tableState(bidding(BOARD, auction)),
			systems: { N: "hcp", E: "hcp", S: "hcp", W: "hcp" },
		} as const;
		expect(view("E", null, { state }).auction?.meanings[0]?.[2]).toBe(text);
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
