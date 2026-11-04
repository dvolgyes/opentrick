import { describe, expect, it } from "vitest";
import {
	boardStatus,
	createBoard,
	legalActions,
} from "../../src/bridge/engine";
import { actionPayload } from "../../src/game/bridge";
import { translator } from "../../src/i18n";
import type { Seat } from "../../src/protocol";
import {
	commandText,
	positionOf,
	type TableView,
} from "../../src/ui/table-model";
import { bidding, call, DEAL, playing } from "./bridge-fixtures";
import {
	ALL,
	afterTricks,
	BOARD,
	CONFIG,
	LED,
	NORTH_DECLARER_BOARD,
	NORTH_OWN_TURN,
	playableCards,
	seatView,
	shownCards,
	TABLE_ID,
	tableState,
	view,
} from "./table-model-fixtures";

describe("play", () => {
	it("offers undo and claims to human dummy controlling a bot declarer", () => {
		const board = playing(bidding(createBoard(1, DEAL), "1S P P P"), "S7 S2");
		const human = view("S", board, { bots: new Set(["N", "E", "W"]) });
		expect(human.undo.canRequest).toBe(true);
		expect(human.claim.canRequest).toBe(true);
		const late = view("S", afterTricks(board, 8), {
			bots: new Set(["N", "E", "W"]),
		});
		expect(late.claim).toMatchObject({
			canRequest: true,
			choosable: true,
			maxTricks: 5,
		});
		for (const bots of [new Set<Seat>(), new Set<Seat>(["N", "S"])]) {
			const other = view("S", board, { bots });
			expect(other.undo.canRequest).toBe(false);
			expect(other.claim.canRequest).toBe(false);
		}
		const autoplay = view("S", board, {
			bots: new Set(["N"]),
			autoplaySeats: new Set(["N"]),
		});
		expect(autoplay.undo.canRequest).toBe(false);
		expect(autoplay.claim.canRequest).toBe(false);
	});
	it("carries the engine winner and four played cards through every viewer orientation, including the final trick", () => {
		for (const count of [1, 13]) {
			const board = afterTricks(NORTH_DECLARER_BOARD, count);
			const finished = boardStatus(board).tricks.at(-1);
			if (!finished) throw new Error("missing finished trick");
			for (const viewer of ["N", "E", "S", "W"] as const) {
				const completed = view(viewer, board).completedTrick;
				expect(completed?.index).toBe(count);
				expect(completed?.winner).toBe(finished.winner);
				expect(completed?.winnerPosition).toBe(
					positionOf(viewer, finished.winner),
				);
				expect(completed?.cards.map((card) => card.card)).toEqual(
					finished.cards,
				);
			}
		}
	});
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
			"Waiting for player1 (N) and player4 (W) to join",
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
			"Waiting for player1 (N) and West to join",
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
		).toBe("Várakozás, hogy csatlakozzanak: player1 (É) és player4 (Ny)");
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
