import {
	type Card,
	rankOf,
	SUIT_SYMBOLS,
	type Suit,
	suitOf,
} from "../bridge/cards";
import type { PointRange } from "../bridge/convention-rules";
import {
	ACE_ANSWERS,
	type CallMeaning,
	callMeaning,
	hasRules,
	type Shape,
} from "../bridge/conventions";
import {
	type Action,
	type BoardResult,
	boardStatus,
	type HandView,
	undoPosition,
	viewForPlayer,
} from "../bridge/engine";
import type { PointSystem } from "../bridge/hand-points";
import type { Call, Contract, Strain, Vulnerability } from "../bridge/rules";
import {
	type BridgeState,
	isTableCommand,
	seatSystems,
	totals,
} from "../game/bridge";
import { englishTranslator as english, type Translate } from "../i18n";
import type { OutboxItem } from "../p2p/outbox";
import type { CommandFailure } from "../p2p/table";
import type { Entry, SeatRoundTrip } from "../p2p/wire";
import {
	isObject,
	type RoomConfig,
	SEAT_NAMES,
	SEATS,
	type Seat,
	seatAfter,
} from "../protocol";

import { playSuitOrder, type TrickNeed, trickNeed } from "./hand-layout";
import { ownCommands, type RosterRow } from "./model";

/** Pure view model of the bridge table: the DOM layer only renders what these functions return. */

// ---------------------------------------------------------------------------------------------------------------
// Text

function strainText(strain: Strain): string {
	return strain === "NT" ? "NT" : SUIT_SYMBOLS[strain];
}

export function rankText(card: Card): string {
	const rank = rankOf(card);
	return rank === "T" ? "10" : rank;
}

export function cardText(card: Card): string {
	return `${SUIT_SYMBOLS[suitOf(card)]}${rankText(card)}`;
}

export function callText(call: Call): string {
	if (call === "P") return "Pass";
	if (call === "X") return "Double";
	if (call === "XX") return "Redouble";
	return `${call[0]}${strainText(call.slice(1) as Strain)}`;
}

/** For example "4♠X" or "3NT". */
export function contractText(contract: Contract): string {
	return `${contract.level}${strainText(contract.strain)}${contract.doubling}`;
}

/** One line for each side, North-South first: for example "N-S vulnerable", then "E-W not vulnerable". */
function vulnerabilityLines(
	vulnerability: Vulnerability,
	t: Translate,
): readonly VulnerabilityLine[] {
	const ns = vulnerability === "NS" || vulnerability === "both";
	const ew = vulnerability === "EW" || vulnerability === "both";
	return [
		{
			side: "ns",
			text: ns ? t("N-S vulnerable") : t("N-S not vulnerable"),
			status: ns ? t("vulnerable") : t("not vulnerable"),
			vulnerable: ns,
		},
		{
			side: "ew",
			text: ew ? t("E-W vulnerable") : t("E-W not vulnerable"),
			status: ew ? t("vulnerable") : t("not vulnerable"),
			vulnerable: ew,
		},
	];
}

/** "=", "+1" or "-2" against the contract; empty for a passed-out board. */
export function outcomeText(result: BoardResult): string {
	if (result.contract === null) return "";
	const over = result.declarerTricks - (result.contract.level + 6);
	return over === 0 ? "=" : over > 0 ? `+${over}` : `${over}`;
}

/** Short text of a table command, for the list of this seat's actions in flight. */
export function commandText(payload: unknown, t: Translate = english): string {
	if (!isObject(payload)) return "";
	if (payload.type === "deal")
		return t("Deal board {board}", { board: String(payload.board) });
	const action = payload.type === "call" ? payload.call : payload.card;
	if (typeof action !== "string") return "";
	if (payload.type === "call")
		return t("Call {call}", { call: t(callText(action as Call)) });
	return t("Play {card}", { card: cardText(action as Card) });
}

/**
 * "Waiting for David (E) and West to come back", in the viewer's language: each seat by its player's name and its
 * letter, or by its direction while it has no player. Undefined for no seats.
 */
export function comeBackText(
	seats: readonly Seat[],
	names: Readonly<Partial<Record<Seat, string>>>,
	t: Translate,
): string | undefined {
	const players = seats.map((seat) => {
		const name = names[seat];
		return name ? `${name} (${t(seat)})` : t(SEAT_NAMES[seat]);
	});
	const last = players.pop();
	if (last === undefined) return undefined;
	return t("Waiting for {players} to come back", {
		players:
			players.length > 0 ? `${players.join(", ")} ${t("and")} ${last}` : last,
	});
}

/**
 * The text of `comeBackText` when seats of `needed` are not present; undefined when all are. The host refuses the
 * action with the same text in English, by direction only (`waitingText`).
 */
function waitingFor(
	needed: readonly Seat[],
	present: readonly Seat[],
	names: Readonly<Record<Seat, string>>,
	t: Translate,
): string | undefined {
	return comeBackText(
		needed.filter((seat) => !present.includes(seat)),
		names,
		t,
	);
}

// ---------------------------------------------------------------------------------------------------------------
// Table

/** Places around the table, as the viewer sees it: the viewer always sits at the bottom. */
export type Position = "bottom" | "left" | "top" | "right";
const POSITIONS: readonly Position[] = ["bottom", "left", "top", "right"];

export function positionOf(viewer: Seat, seat: Seat): Position {
	const steps = (SEATS.indexOf(seat) - SEATS.indexOf(viewer) + 4) % 4;
	return POSITIONS[steps] as Position;
}

export interface CardView {
	readonly card: Card;
	readonly rank: string;
	readonly suit: Suit;
	/** For example "♠10". */
	readonly text: string;
	/** The viewer may play this card now. */
	readonly playable: boolean;
}

export interface SuitRow {
	readonly suit: Suit;
	readonly symbol: string;
	readonly cards: readonly CardView[];
	/** The trump group of the declaring pair's hands; it gets the gold frame and label (layout spec §7). */
	readonly trump: boolean;
}

export type HandDisplay =
	| { readonly visible: true; readonly suits: readonly SuitRow[] }
	| { readonly visible: false; readonly count: number };

/** The seat's call or card is next. Declarer acts for dummy, so dummy's pill is declarer's. */
export interface TurnPill {
	readonly action: "bid" | "play";
	readonly yours: boolean;
}

export interface SeatView {
	readonly seat: Seat;
	readonly position: Position;
	/** This seat is controlled by a host-managed bot, as reported in the shared roster. */
	readonly bot: boolean;
	/** The seat tag and the player name, such as "E - David"; the seat name alone while the seat is free. */
	readonly label: string;
	/** The player's name; empty while the seat is free. */
	readonly name: string;
	readonly tags: readonly string[];
	/** This seat's call or card is next. */
	readonly turn: boolean;
	readonly hand: HandDisplay;
	/** Whether a player holds the seat, and whether that player is connected. Only the lobby shows it. */
	readonly presence: RosterRow["state"];
	/** The viewer is not the host and the host is not connected yet (bridge-connection-room). */
	readonly connecting: boolean;
	/** The pill on the seat whose call or card is next; it is the viewer's when the viewer acts for that seat. */
	readonly turnPill: TurnPill | undefined;
	/** The cards to count the points of: a hand the viewer can see during the auction, or every hand once the board is over. */
	readonly pointCards: readonly Card[] | undefined;
	/** The network quality from the host's last round trip to this seat's player; undefined for a seat the host does not measure. */
	readonly roundTrip: RoundTripView | undefined;
}

/**
 * The network quality for the video tile, such as "Network: good", with the round trip as `title`. The quality
 * follows the shown hundredths: excellent up to 0.10 s, good up to 0.30 s, average up to 0.60 s, poor below 2.00 s,
 * and breaking up from 2.00 s. A ping without an echo is breaking up too. A connected player whom the host has not
 * measured yet shows "Network: measuring…" and has no round trip. A guest sees its own round trip beside the host.
 */
export interface RoundTripView {
	readonly text: string;
	readonly title?: string;
	readonly quality:
		| "excellent"
		| "good"
		| "average"
		| "poor"
		| "breaking-up"
		| "pending";
}

export interface PlayedCard {
	readonly seat: Seat;
	readonly position: Position;
	readonly card: Card;
	readonly text: string;
	/** The rank and the suit symbol, drawn as a full card. */
	readonly rank: string;
	readonly symbol: string;
}

export interface TrickView {
	readonly cards: readonly PlayedCard[];
	/** All four cards are played; the table shows this trick until the next card is led. */
	readonly finished: boolean;
}

export interface AuctionView {
	readonly seats: readonly Seat[];
	/**
	 * Rows of up to four cells in `seats` order. A seat before the dealer could not call, so its cell is a dash; the
	 * last row stops at the last call, and the calls still to come have no cell.
	 */
	readonly rows: readonly (readonly string[])[];
	/** The bidding system of each seat, in `seats` order; undefined when the seat's player has sent none. */
	readonly systems: readonly (PointSystem | undefined)[];
	/** The calls so far, in order, for the bidding guide. */
	readonly calls: readonly Call[];
	/**
	 * In `rows` order, what each call shows by its caller's system in the viewer's language, such as "15–17 HCP,
	 * balanced"; undefined for a dash and for a call that the guide does not describe.
	 */
	readonly meanings: readonly (readonly (string | undefined)[])[];
}

export interface BidView {
	readonly call: Call;
	readonly text: string;
}

export type TableActionState =
	| "sending"
	| "pending"
	| "not-accepted"
	| "undone";

export interface TableActionLine {
	readonly id: string;
	readonly text: string;
	readonly state: TableActionState;
	readonly reason?: string;
}

export interface ScoreRow {
	readonly number: number;
	readonly contract: string;
	readonly declarer: string;
	readonly outcome: string;
	readonly ns: string;
	readonly ew: string;
}

export interface NextBoard {
	readonly board: number;
	readonly ready: boolean;
}

/** Returns the next board to deal once, after scoring and only while this page hosts. */
export function autoDealBoard(
	hosting: boolean,
	currentBoard: number,
	countdown: number | undefined,
	nextBoard: NextBoard | undefined,
	alreadyDealtBoard: number | undefined,
): number | undefined {
	if (
		!hosting ||
		countdown !== 0 ||
		!nextBoard?.ready ||
		nextBoard.board === currentBoard ||
		nextBoard.board === alreadyDealtBoard
	)
		return undefined;
	return nextBoard.board;
}

export interface ScoringView {
	readonly contract:
		| Pick<Contract, "level" | "strain" | "doubling">
		| undefined;
	readonly compactOutcome: "WON" | "LOST" | "PASSED OUT";
	readonly compactDetail: string;
	readonly countdown: number;
}

export interface UndoPanelView {
	readonly canRequest: boolean;
	readonly message: string;
	readonly requestId: string | undefined;
	readonly canVote: boolean;
	readonly canCancel: boolean;
}

/** The most remaining tricks for which "Claim …" offers a button for each count. "Claim all" stays for more. */
export const CLAIM_CHOICE_MAX = 5;

export interface ClaimPanelView {
	readonly canRequest: boolean;
	readonly maxTricks: number;
	/** True during play when CLAIM_CHOICE_MAX tricks or fewer remain, so the table offers "Claim …". */
	readonly choosable: boolean;
	readonly requestId: string | undefined;
	readonly requester: string;
	readonly tricks: number;
	readonly message: string;
	readonly canVote: boolean;
}

/** The contract shown in the sidebar header: "1♣ by North · Anna". Undefined until the auction has a contract. */
export interface ContractHeader {
	readonly level: number;
	readonly strain: Strain;
	/** The strain as text: a suit symbol, or "NT". */
	readonly symbol: string;
	readonly doubling: string;
	readonly declarer: Seat;
	/** The declarer's seat name, such as "North". */
	readonly direction: string;
	/** The declarer's player name; empty while the seat is free. */
	readonly name: string;
}

/** The vulnerability of one side, as a line of text. */
export interface VulnerabilityLine {
	readonly side: "ns" | "ew";
	/** With the side, for example "E-W vulnerable". */
	readonly text: string;
	/** Without the side, for example "vulnerable". */
	readonly status: string;
	readonly vulnerable: boolean;
}

export interface TableView {
	readonly phase:
		| "loading"
		| "unreadable"
		| "waiting"
		| "auction"
		| "play"
		| "complete";
	/** The board on the table; 0 before the first deal. */
	readonly board: number;
	/** The number of calls and cards made on the board: the table position that actions are sent for. */
	readonly at: number;
	/** For example "Board 3", empty before the first deal. */
	readonly heading: string;
	/** For example "Dealer: North". */
	readonly details: string;
	/** The vulnerability of North-South, then of East-West; empty before the first deal. */
	readonly vulnerability: readonly VulnerabilityLine[];
	readonly prompt: string;
	/** "Waiting for … to come back" while a dealt board waits for the absent seat to act (plan §12 R4); empty otherwise. */
	readonly waiting: string;
	/** This player can act now. */
	readonly yourTurn: boolean;
	readonly seats: readonly SeatView[];
	readonly auction: AuctionView | undefined;
	readonly bids: readonly BidView[];
	readonly contract: string;
	readonly header: ContractHeader | undefined;
	readonly tricks: string;
	readonly trick: TrickView | undefined;
	/** The viewer's partnership counts and target during play; undefined before play. */
	readonly need: TrickNeed | undefined;
	/** "Contract secured" or "Contract defeated" once decided; empty while open. */
	readonly trickStatus: string;
	readonly scoring: ScoringView | undefined;
	readonly nextBoard: NextBoard | undefined;
	readonly actions: readonly TableActionLine[];
	readonly undo: UndoPanelView;
	readonly claim: ClaimPanelView;
	readonly scores: readonly ScoreRow[];
	readonly totals: { readonly ns: number; readonly ew: number };
	/** The "Previous game statistics" panel: the results of the boards played so far. */
	readonly statistics: { readonly ns: SideStats; readonly ew: SideStats };
}

/** One side's record over the boards played so far. A board is won by the side that scored on it. */
export interface SideStats {
	readonly won: number;
	readonly lost: number;
	readonly total: number;
}

export interface TableViewInput {
	readonly config: RoomConfig;
	readonly seat: Seat;
	/** The parsed table; `undefined` while the room is loading, `null` when its state is not a bridge table. */
	readonly state: BridgeState | null | undefined;
	/** The tab can no longer act (superseded, expired or stopped). */
	readonly terminal: boolean;
	/** The host's seat and the seats whose peer is connected to the host (plan §12 R4). */
	readonly present: ReadonlySet<Seat>;
	/** Every seat with its holder's connection state; a seat missing here is free. */
	readonly roster: readonly RosterRow[];
	/** Bot-controlled seats from the shared table roster. */
	readonly bots?: ReadonlySet<Seat>;
	/** The host's seat, or null while the host is not known. */
	readonly hostSeat: Seat | null;
	/** Seconds until the next board is dealt after scoring. */
	readonly scoringCountdown?: number;
	/** This seat's commands that are not in the log. */
	readonly outbox: readonly OutboxItem[];
	readonly failures: readonly CommandFailure[];
	readonly undone: readonly Entry[];
	/** The host's last round trip to each measured seat. */
	readonly roundTrips?: readonly SeatRoundTrip[];
	readonly t?: Translate;
}

const EMPTY: Omit<TableView, "phase" | "prompt"> = {
	board: 0,
	at: 0,
	heading: "",
	details: "",
	vulnerability: [],
	waiting: "",
	yourTurn: false,
	seats: [],
	auction: undefined,
	bids: [],
	contract: "",
	header: undefined,
	tricks: "",
	trick: undefined,
	need: undefined,
	trickStatus: "",
	scoring: undefined,
	nextBoard: undefined,
	actions: [],
	undo: {
		canRequest: false,
		message: "",
		requestId: undefined,
		canVote: false,
		canCancel: false,
	},
	claim: {
		canRequest: false,
		maxTricks: 0,
		choosable: false,
		requestId: undefined,
		requester: "",
		tricks: 0,
		message: "",
		canVote: false,
	},
	scores: [],
	totals: { ns: 0, ew: 0 },
	statistics: {
		ns: { won: 0, lost: 0, total: 0 },
		ew: { won: 0, lost: 0, total: 0 },
	},
};

function sideStats(results: readonly BoardResult[]): {
	ns: SideStats;
	ew: SideStats;
} {
	const sums = totals(results);
	const count = (test: (scoreNS: number) => boolean): number =>
		results.filter((result) => test(result.scoreNS)).length;
	return {
		ns: {
			won: count((score) => score > 0),
			lost: count((score) => score < 0),
			total: sums.ns,
		},
		ew: {
			won: count((score) => score < 0),
			lost: count((score) => score > 0),
			total: sums.ew,
		},
	};
}

function presenceOf(
	roster: readonly RosterRow[],
	owner: Seat,
): RosterRow["state"] {
	return roster.find((row) => row.seat === owner)?.state ?? "free";
}

/**
 * The four seats of the lobby, before the first deal. A free seat shows no name and no cards; a joined seat
 * shows backs. The viewer's own backs appear only while the viewer waits for the host to connect.
 */
function lobbySeats(input: TableViewInput, t: Translate): SeatView[] {
	const { seat, config, roster, hostSeat, present, bots } = input;
	const hostOnline = hostSeat !== null && present.has(hostSeat);
	return SEATS.map((owner): SeatView => {
		const presence = presenceOf(roster, owner);
		const joined = presence !== "free";
		const connecting = owner === seat && hostSeat !== seat && !hostOnline;
		const backs = joined && (owner !== seat || connecting);
		return {
			seat: owner,
			position: positionOf(seat, owner),
			bot: bots?.has(owner) ?? false,
			label: joined
				? `${t(owner)} - ${config.names[owner]}${bots?.has(owner) ? " 🤖" : ""}`
				: t(SEAT_NAMES[owner]),
			name: joined ? config.names[owner] : "",
			tags: owner === hostSeat ? ["Host"] : [],
			turn: false,
			hand: { visible: false, count: backs ? 13 : 0 },
			presence,
			connecting,
			turnPill: undefined,
			pointCards: undefined,
			roundTrip: roundTripView(input, owner, t),
		};
	});
}

function roundTripView(
	input: TableViewInput,
	owner: Seat,
	t: Translate,
): RoundTripView | undefined {
	// The host does not measure itself, but a guest's round trip to the host is the same in both directions.
	const guestToHost = owner === input.hostSeat && owner !== input.seat;
	const measuredSeat = guestToHost ? input.seat : owner;
	const measured = input.roundTrips?.find((row) => row.seat === measuredSeat);
	if (measured === undefined) {
		// The host measures every other connected player, but not its bots.
		const measurable =
			(owner !== input.hostSeat || guestToHost) &&
			input.present.has(owner) &&
			!(input.bots?.has(owner) ?? false);
		return measurable
			? { text: t("Network: measuring…"), quality: "pending" }
			: undefined;
	}
	// The quality follows the shown hundredths, so 0.104 s shows as "0.10sec" and is excellent.
	const hundredths = Math.round(measured.ms / 10);
	const seconds = (hundredths / 100).toFixed(2);
	if (measured.lower)
		return {
			text: t("Network: breaking up"),
			title: t("Roundtrip: >{seconds}sec", { seconds }),
			quality: "breaking-up",
		};
	const title = t("Roundtrip: {seconds}sec", { seconds });
	if (hundredths <= 10)
		return { text: t("Network: excellent"), title, quality: "excellent" };
	if (hundredths <= 30)
		return { text: t("Network: good"), title, quality: "good" };
	if (hundredths <= 60)
		return { text: t("Network: average"), title, quality: "average" };
	if (hundredths < 200)
		return { text: t("Network: poor"), title, quality: "poor" };
	return { text: t("Network: breaking up"), title, quality: "breaking-up" };
}

function payloadBoard(payload: unknown): number {
	return isObject(payload) && typeof payload.board === "number"
		? payload.board
		: 0;
}

function isDealFor(payload: unknown, board: number): boolean {
	return (
		isObject(payload) && payload.type === "deal" && payload.board === board
	);
}

/**
 * This seat's table commands that still concern the table: in flight, refused with the reason, or undone by a
 * host change. Actions count for the current board, deals for a later board; a deal that lost the race to
 * another seat's deal is moot.
 */
function actionLines(
	input: TableViewInput,
	current: number,
): TableActionLine[] {
	const t = input.t ?? english;
	const relevant = (payload: unknown): boolean =>
		isTableCommand(payload) &&
		(isDealFor(payload, payloadBoard(payload))
			? payloadBoard(payload) > current
			: payloadBoard(payload) >= current);
	return ownCommands(input)
		.filter((line) => relevant(line.payload))
		.map((line) => ({
			id: line.id,
			text: commandText(line.payload, t),
			state: line.state === "not-sent" ? "not-accepted" : line.state,
			...(line.reason === undefined ? {} : { reason: line.reason }),
		}));
}

function suitRows(
	cards: readonly Card[],
	playable: ReadonlySet<Card>,
	order: readonly Suit[],
	trump: Suit | undefined,
): SuitRow[] {
	return order.map((suit) => ({
		suit,
		symbol: SUIT_SYMBOLS[suit],
		trump: suit === trump,
		cards: cards
			.filter((card) => suitOf(card) === suit)
			.map((card) => ({
				card,
				rank: rankText(card),
				text: cardText(card),
				suit,
				playable: playable.has(card),
			})),
	}));
}

function handDisplay(
	hand: HandView,
	playable: ReadonlySet<Card>,
	order: readonly Suit[],
	trump: Suit | undefined,
): HandDisplay {
	return hand.visible
		? { visible: true, suits: suitRows(hand.cards, playable, order, trump) }
		: { visible: false, count: hand.count };
}

/** The contract outcome, once decided. `status` is about the declarers, so it reads the same for every viewer. */
function contractHeader(
	contract: Contract | null | undefined,
	seats: readonly SeatView[],
	t: Translate,
): ContractHeader | undefined {
	if (!contract) return undefined;
	const declarer = seats.find((seat) => seat.seat === contract.declarer);
	return {
		level: contract.level,
		strain: contract.strain,
		symbol: strainText(contract.strain),
		doubling: contract.doubling,
		declarer: contract.declarer,
		direction: t(SEAT_NAMES[contract.declarer]),
		name: declarer?.name ?? "",
	};
}

function trickStatusText(status: TrickNeed["status"], t: Translate): string {
	if (status === "open") return "";
	return t(status === "secured" ? "Contract secured" : "Contract defeated");
}

function scoreRows(results: readonly BoardResult[]): ScoreRow[] {
	return results.map((result) => {
		const { contract, scoreNS } = result;
		return {
			number: result.number,
			contract: contract ? contractText(contract) : "Passed out",
			declarer: contract ? contract.declarer : "",
			outcome: outcomeText(result),
			ns: scoreNS > 0 ? String(scoreNS) : "",
			ew: scoreNS < 0 ? String(-scoreNS) : "",
		};
	});
}

/** The scale of each system's points, as the meaning of a call names it. */
const SCALE_NAMES: Readonly<Record<PointSystem, string>> = {
	hcp: "HCP",
	"hcp-corrected": "corrected HCP",
	vienna: "Vienna points",
	reith: "Reith points",
	"four-aces": "Four Aces points",
	other: "points",
};

/** Four Aces counts half points: 7.5 is "7½", as in its guide. */
function pointsText(points: number): string {
	return Number.isInteger(points) ? String(points) : `${Math.floor(points)}½`;
}

function rangeText(
	range: PointRange,
	system: PointSystem,
	t: Translate,
): string {
	const scale = t(SCALE_NAMES[system]);
	const min = pointsText(range.min);
	return range.max === undefined
		? t("{min}+ {scale}", { min, scale })
		: t("{min}–{max} {scale}", { min, max: pointsText(range.max), scale });
}

function shapeText(shape: Shape, system: PointSystem, t: Translate): string {
	switch (shape.kind) {
		case "none":
			return "";
		case "balanced":
			return t("balanced");
		case "artificial":
			return t("artificial and forcing");
		case "cards":
			return `${shape.min}+ ${SUIT_SYMBOLS[shape.suit]}`;
		case "support":
			return t("{min}+ {suit} support", {
				min: shape.min,
				suit: SUIT_SYMBOLS[shape.suit],
			});
		case "weak-two":
			return t("weak two, a good {length}-card {suit} suit", {
				length: shape.length,
				suit: SUIT_SYMBOLS[shape.suit],
			});
		case "preempt":
			return t("preempt, a good {length}-card {suit} suit", {
				length: shape.length,
				suit: SUIT_SYMBOLS[shape.suit],
			});
		case "transfer":
			return t("transfer, {min}+ {suit}", {
				min: shape.min,
				suit: SUIT_SYMBOLS[shape.suit],
			});
		case "stayman":
			return t("Stayman, a {min}-card major", { min: shape.min });
		case "weak-minor":
			return t("weak, a {min}+ card minor", { min: shape.min });
		case "game-try":
			return t("game try, invites game, {min}+ {suit}", {
				min: shape.min,
				suit: SUIT_SYMBOLS[shape.suit],
			});
		case "competitive":
			return t("competitive, no game invitation, {min}+ {suit}", {
				min: shape.min,
				suit: SUIT_SYMBOLS[shape.suit],
			});
		case "waiting":
			return t("waiting");
		case "rest":
			return t("no other guide call fits");
		case "good-suit":
			return t("a good {min}+ card {suit} suit", {
				min: shape.min,
				suit: SUIT_SYMBOLS[shape.suit],
			});
		case "no-major":
			return t("no {min}-card major", { min: shape.min });
		case "accept":
			return `${t("completes the transfer to {suit}", {
				suit: SUIT_SYMBOLS[shape.suit],
			})}. ${t("Three-card support is not required.")}`;
		case "short-suit":
			return t("at most {max} {suit} after the transfer was doubled", {
				max: shape.max,
				suit: SUIT_SYMBOLS[shape.suit],
			});
		case "relay":
			return t("forced, any hand");
		case "ask":
			return t("asks opener to describe the hand");
		case "stopper":
			return t("balanced, a {suit} stopper", {
				suit: SUIT_SYMBOLS[shape.suit],
			});
		case "takeout":
			return t("takeout, short in {suit}, or {strong}", {
				suit: SUIT_SYMBOLS[shape.suit],
				strong: rangeText(shape.strong, system, t),
			});
		case "blackwood":
			return t(
				"Blackwood, asks for aces: a small slam needs about {small} together, a grand slam about {grand}",
				{
					small: rangeText(shape.small, system, t),
					grand: rangeText(shape.grand, system, t),
				},
			);
		case "aces":
			return t("aces: {counts}", { counts: shape.counts.join("/") });
	}
}

/** For example "15–17 HCP, balanced". */
export function meaningText(
	meaning: CallMeaning,
	system: PointSystem,
	t: Translate,
): string {
	return [
		meaning.range === undefined ? "" : rangeText(meaning.range, system, t),
		shapeText(meaning.shape, system, t),
	]
		.filter((part) => part !== "")
		.join(", ");
}

/**
 * The Confirm hint of the [4NT] ask, two lines: the slam targets, and the answers. For example "Blackwood: 33+/37+
 * HCP" and "Aces: 5♣:0/4 5♦:1 5♥:2 5♠:3".
 */
export function blackwoodHint(
	shape: Extract<Shape, { kind: "blackwood" }>,
	system: PointSystem,
	t: Translate,
): string {
	const answers = Object.entries(ACE_ANSWERS)
		.map(([call, counts]) => `${callText(call as Call)}:${counts.join("/")}`)
		.join(" ");
	return [
		t("Blackwood: {small}/{grand}", {
			small: `${pointsText(shape.small.min)}+`,
			grand: rangeText(shape.grand, system, t),
		}),
		t("Aces: {answers}", { answers }),
	].join("\n");
}

function auctionView(
	dealer: Seat,
	calls: readonly Call[],
	systems: BridgeState["systems"],
	bots: ReadonlySet<Seat> | undefined,
	t: Translate,
	botSystem: PointSystem = "other",
): AuctionView {
	const before = SEATS.indexOf(dealer);
	const bySeat = seatSystems(systems, bots ?? [], botSystem);
	// A call of a system with rules gets its meaning, or "not in the guide"; a call of the other systems gets none.
	const meaning = (index: number): string | undefined => {
		const system = bySeat[seatAfter(dealer, index)];
		if (system === undefined || !hasRules(system)) return undefined;
		const found = callMeaning(system, calls, index);
		return found === undefined
			? t("not in the guide")
			: meaningText(found, system, t);
	};
	const cells = [
		...Array.from({ length: before }, () => "—"),
		...calls.map(callText),
	];
	const meanings = [
		...Array.from({ length: before }, () => undefined),
		...calls.map((_, index) => meaning(index)),
	];
	const rows: string[][] = [];
	const meaningRows: (string | undefined)[][] = [];
	for (let i = 0; i < cells.length; i += 4) {
		rows.push(cells.slice(i, i + 4));
		meaningRows.push(meanings.slice(i, i + 4));
	}
	return {
		seats: SEATS,
		rows,
		systems: SEATS.map((seat) => bySeat[seat]),
		calls,
		meanings: meaningRows,
	};
}

/** One action of this seat at a time: further clicks wait until the host has decided on the last one. */
function busy(lines: readonly TableActionLine[]): boolean {
	return lines.some(
		(line) => line.state === "sending" || line.state === "pending",
	);
}

function undoPanelView(
	state: BridgeState,
	seat: Seat,
	config: RoomConfig,
	terminal: boolean,
	declarerIsBot: boolean,
	outbox: readonly OutboxItem[],
	t: Translate,
): UndoPanelView {
	const pending = state.undo;
	const board = state.board;
	if (!pending) {
		const sending = outbox.some((item) => item.payload.type === "undo-request");
		return {
			canRequest:
				!terminal &&
				!declarerIsBot &&
				!sending &&
				state.claim === null &&
				state.claimResult === null &&
				state.undo === null &&
				board !== null &&
				undoPosition(board, seat) !== undefined,
			message: sending ? t("Undo request is being sent.") : "",
			requestId: undefined,
			canVote: false,
			canCancel: false,
		};
	}
	const waiting = pending.required.filter(
		(voter) => !pending.approved.includes(voter),
	);
	const waitingNames = waiting.map((voter) => config.names[voter]);
	const last = waitingNames.pop();
	const waitingText =
		last === undefined
			? ""
			: t("Waiting for {players} to approve.", {
					players: [...waitingNames, last].join(", "),
				});
	const requester = config.names[pending.requester];
	const action = t(
		pending.cards < (board?.cards.length ?? 0)
			? "last played card"
			: "last bid",
	);
	const voted = pending.approved.includes(seat);
	const voteSending = outbox.some(
		(item) =>
			item.payload.type === "undo-vote" &&
			item.payload.requestId === pending.id,
	);
	const cancelSending = outbox.some(
		(item) =>
			item.payload.type === "undo-cancel" &&
			item.payload.requestId === pending.id,
	);
	const canVote =
		!terminal && pending.required.includes(seat) && !voted && !voteSending;
	return {
		canRequest: false,
		message:
			pending.requester === seat
				? cancelSending
					? t(
							"You ask to undo your {action}. Your cancellation is being sent.",
							{ action },
						)
					: t("You ask to undo your {action}. {waiting}", {
							action,
							waiting: waitingText,
						})
				: voteSending
					? t(
							"{requester} asks to undo their {action}. Your vote is being sent.",
							{ requester, action },
						)
					: voted
						? t(
								"{requester} asks to undo their {action}. Your approval is recorded. {waiting}",
								{ requester, action, waiting: waitingText },
							)
						: canVote
							? t("{requester} asks to undo their {action}. Do you approve?", {
									requester,
									action,
								})
							: t("{requester} asks to undo their {action}. {waiting}", {
									requester,
									action,
									waiting: waitingText,
								}),
		requestId: pending.id,
		canVote,
		canCancel: !terminal && pending.requester === seat && !cancelSending,
	};
}

function claimPanelView(
	state: BridgeState,
	seat: Seat,
	config: RoomConfig,
	terminal: boolean,
	declarerIsBot: boolean,
	outbox: readonly OutboxItem[],
	t: Translate,
): ClaimPanelView {
	const pending = state.claim;
	const board = state.board;
	const status = board ? boardStatus(board) : undefined;
	const remaining = status?.phase === "play" ? 13 - status.tricks.length : 0;
	const choosable = remaining > 0 && remaining <= CLAIM_CHOICE_MAX;
	if (!pending) {
		const sending = outbox.some(
			(item) => item.payload.type === "claim-request",
		);
		return {
			canRequest:
				!terminal &&
				!declarerIsBot &&
				!sending &&
				state.undo === null &&
				state.claimResult === null &&
				status?.phase === "play" &&
				status.actor === seat &&
				status.contract.declarer === seat,
			maxTricks: remaining,
			choosable,
			requestId: undefined,
			requester: "",
			tricks: 0,
			message: sending ? t("Claim request is being sent.") : "",
			canVote: false,
		};
	}
	const waiting = pending.required.filter(
		(voter) => !pending.approved.includes(voter),
	);
	const names = waiting.map((voter) => config.names[voter]);
	const last = names.pop();
	const waitingText =
		last === undefined
			? ""
			: t("Waiting for {players} to decide.", {
					players: [...names, last].join(", "),
				});
	const requester = config.names[pending.requester];
	const voteSending = outbox.some(
		(item) =>
			item.payload.type === "claim-vote" &&
			item.payload.requestId === pending.id,
	);
	const approved = pending.approved.includes(seat);
	const tricks = t(pending.tricks === 1 ? "trick" : "tricks");
	const canVote =
		!terminal && pending.required.includes(seat) && !approved && !voteSending;
	return {
		canRequest: false,
		maxTricks: 0,
		choosable,
		requestId: pending.id,
		requester,
		tricks: pending.tricks,
		message:
			pending.requester === seat
				? t("Your claim for {count} {tricks} is waiting. {waiting}", {
						count: pending.tricks,
						tricks,
						waiting: waitingText,
					})
				: voteSending
					? t(
							"{requester} claims {count} {tricks}. Your decision is being sent.",
							{ requester, count: pending.tricks, tricks },
						)
					: approved
						? t(
								"{requester} claims {count} {tricks}. You accepted. {waiting}",
								{
									requester,
									count: pending.tricks,
									tricks,
									waiting: waitingText,
								},
							)
						: canVote
							? t(
									"{requester} claims {count} {tricks}. Do you accept the claim?",
									{ requester, count: pending.tricks, tricks },
								)
							: t("{requester} claims {count} {tricks}. {waiting}", {
									requester,
									count: pending.tricks,
									tricks,
									waiting: waitingText,
								}),
		canVote,
	};
}

export function tableView(input: TableViewInput): TableView {
	const { state, seat, config } = input;
	const t = input.t ?? english;
	if (state === undefined)
		return { ...EMPTY, phase: "loading", prompt: t("Loading the table…") };
	if (state === null)
		return {
			...EMPTY,
			phase: "unreadable",
			prompt: t("This room has no bridge table."),
		};
	const scores = scoreRows(state.results);
	const sums = totals(state.results);
	const board = state.board;
	const current = board?.number ?? 0;
	const actions = actionLines(input, current);
	const localBot = input.bots?.has(seat) ?? false;
	const localActionAllowed = !input.terminal && !localBot;
	const canStartAction =
		!input.terminal &&
		!busy(actions) &&
		state.undo === null &&
		state.claim === null;
	const canAct =
		localActionAllowed && canStartAction && state.claimResult === null;
	const currentStatus = board ? boardStatus(board) : undefined;
	const declarerIsBot =
		currentStatus !== undefined &&
		currentStatus.contract !== undefined &&
		currentStatus.contract !== null &&
		(input.bots?.has(currentStatus.contract.declarer) ?? false);
	const undo = undoPanelView(
		state,
		seat,
		config,
		!localActionAllowed,
		declarerIsBot,
		input.outbox,
		t,
	);
	const claim = claimPanelView(
		state,
		seat,
		config,
		!localActionAllowed,
		declarerIsBot,
		input.outbox,
		t,
	);
	// The host refuses each deal unless all four seats are present; in a board, only the seat to act must be
	// (plan §12 R4).
	const allPresent = [...input.present];
	const dealWait = waitingFor(SEATS, allPresent, config.names, t);
	const nextBoard = (): NextBoard => {
		const next = current + 1;
		return {
			board: next,
			ready: canStartAction && dealWait === undefined,
		};
	};
	if (!board)
		return {
			...EMPTY,
			phase: "waiting",
			heading: "ROOM CONNECTION",
			details: "Room lobby",
			prompt: dealWait ?? t("The first board is dealt now."),
			seats: lobbySeats(input, t),
			nextBoard: nextBoard(),
			actions,
			undo,
			claim,
			scores,
			totals: sums,
		};

	const revealedSeats = state.claimResult
		? SEATS
		: state.claim
			? [state.claim.requester]
			: [];
	const rawView = viewForPlayer(board, seat, revealedSeats);
	const rawCompletedView = state.claimResult
		? (() => {
				const status = boardStatus(board);
				if (status.phase !== "play") return rawView;
				const remaining = 13 - status.tricks.length;
				const claimsNS =
					state.claimResult.requester === "N" ||
					state.claimResult.requester === "S";
				const tricksNS =
					status.tricksNS +
					(claimsNS
						? state.claimResult.tricks
						: remaining - state.claimResult.tricks);
				return {
					...rawView,
					phase: "complete" as const,
					turn: undefined,
					actor: undefined,
					tricksNS,
					tricksEW: 13 - tricksNS,
					result: state.claimResult.result,
				};
			})()
		: rawView;
	const view =
		rawCompletedView.phase === "complete"
			? {
					...rawCompletedView,
					hands: Object.fromEntries(
						SEATS.map((owner) => [
							owner,
							{ visible: true as const, cards: board.deal[owner] },
						]),
					) as typeof rawCompletedView.hands,
				}
			: rawCompletedView;
	// Only the seat to act must be present. During play, declarer plays dummy's cards, so dummy may be away.
	const toAct =
		view.phase === "auction"
			? view.turn
			: view.phase === "play"
				? view.actor
				: undefined;
	const actionWait =
		toAct === undefined
			? undefined
			: waitingFor([toAct], allPresent, config.names, t);
	const legal = canAct && actionWait === undefined ? view.legal : [];
	const playable = new Set(
		legal.flatMap((action: Action) =>
			action.type === "play" ? [action.card] : [],
		),
	);
	const { contract, dummy } = view;
	// Dealer, declarer and dummy are shown in the details and the contract line, not as panel badges (layout spec §4).
	// Every hand carries the trump suit first, or last on the right of the viewer (layout spec §7); dummy on a side
	// carries it on dummy's own right.
	const suitOrder = (owner: Seat): readonly Suit[] =>
		playSuitOrder(
			view.phase === "auction" ? undefined : contract?.strain,
			positionOf(seat, owner),
			owner === dummy,
		);
	const trumpOf = (): Suit | undefined =>
		contract && contract.strain !== "NT" ? contract.strain : undefined;
	const need =
		contract && view.phase === "play"
			? trickNeed(seat, contract, view.tricksNS, view.tricksEW)
			: undefined;
	const seats = SEATS.map((owner): SeatView => {
		const tags = [
			...(owner === input.hostSeat ? ["Host"] : []),
			...(view.phase === "play" && owner === dummy ? ["Dummy"] : []),
			...(view.phase === "play" && owner === contract?.declarer
				? ["Declarer"]
				: []),
		];
		return {
			seat: owner,
			position: positionOf(seat, owner),
			bot: input.bots?.has(owner) ?? false,
			label: `${t(owner)} - ${config.names[owner]}${input.bots?.has(owner) ? " 🤖" : ""}`,
			name: config.names[owner],
			tags,
			turn: owner === view.turn,
			hand: handDisplay(
				view.hands[owner],
				playable,
				suitOrder(owner),
				trumpOf(),
			),
			presence: presenceOf(input.roster, owner),
			connecting: false,
			turnPill:
				view.phase !== "complete" && owner === view.turn
					? {
							action: view.phase === "auction" ? "bid" : "play",
							yours: view.actor === seat,
						}
					: undefined,
			pointCards:
				(view.phase === "auction" || view.phase === "complete") &&
				view.hands[owner].visible
					? view.hands[owner].cards
					: undefined,
			roundTrip: roundTripView(input, owner, t),
		};
	});

	const lastTrick = view.tricks.at(-1);
	const showLast =
		view.current === undefined || view.current.cards.length === 0;
	const trickSource =
		showLast && lastTrick
			? {
					leader: lastTrick.leader,
					cards: lastTrick.cards,
					finished: true,
				}
			: view.current && {
					leader: view.current.leader,
					cards: view.current.cards,
					finished: false,
				};
	const trick: TrickView | undefined =
		view.phase === "complete"
			? undefined
			: trickSource && {
					cards: trickSource.cards.map((card, index) => {
						const player = seatAfter(trickSource.leader, index);
						return {
							seat: player,
							position: positionOf(seat, player),
							card,
							text: cardText(card),
							rank: rankText(card),
							symbol: SUIT_SYMBOLS[suitOf(card)],
						};
					}),
					finished: trickSource.finished,
				};

	const common = {
		...EMPTY,
		board: board.number,
		at: board.calls.length + board.cards.length,
		heading: t("Board {number}", { number: board.number }),
		details: t("Dealer: {dealer}", { dealer: t(SEAT_NAMES[view.dealer]) }),
		vulnerability: vulnerabilityLines(view.vulnerability, t),
		seats,
		auction: auctionView(
			view.dealer,
			view.calls,
			state.systems,
			input.bots,
			t,
			"other",
		),
		contract: contract
			? t("{contract} by {declarer}", {
					contract: contractText(contract),
					declarer: t(SEAT_NAMES[contract.declarer]),
				})
			: "",
		header: contractHeader(contract, seats, t),
		tricks: contract
			? t("Tricks: N-S {ns} · E-W {ew}", {
					ns: view.tricksNS,
					ew: view.tricksEW,
				})
			: "",
		trick,
		need,
		trickStatus: need ? trickStatusText(need.status, t) : "",
		actions,
		undo,
		claim,
		scores,
		totals: sums,
		statistics: sideStats(state.results),
	};

	if (view.phase === "complete") {
		const result = state.results.find((item) => item.number === board.number);
		const contract = result?.contract;
		const declarerMade =
			contract !== undefined &&
			contract !== null &&
			result !== undefined &&
			result.declarerTricks >= contract.level + 6;
		const viewerWon =
			contract !== undefined &&
			contract !== null &&
			result !== undefined &&
			((seat === "N" || seat === "S") ===
				(contract.declarer === "N" || contract.declarer === "S")) ===
				declarerMade;
		const margin =
			contract !== undefined && contract !== null && result !== undefined
				? Math.abs(result.declarerTricks - (contract.level + 6))
				: 0;
		const viewerIsDeclarerSide =
			contract !== undefined &&
			contract !== null &&
			(seat === "N" || seat === "S") ===
				(contract.declarer === "N" || contract.declarer === "S");
		const compactDetail = contract
			? viewerIsDeclarerSide
				? declarerMade
					? margin === 0
						? t("Made contract")
						: t("Made +{margin}", { margin })
					: t("Down {margin}", { margin })
				: declarerMade
					? margin === 0
						? t("Opponents made contract")
						: t("Opponents made +{margin}", { margin })
					: t("Opponents down {margin}", { margin })
			: "";
		const countdown = input.scoringCountdown ?? 10;
		return {
			...common,
			phase: "complete",
			prompt: "",
			// When the countdown ends, the next board waits for the absent seats.
			waiting: countdown === 0 ? (dealWait ?? "") : "",
			scoring: {
				contract: contract ?? undefined,
				compactOutcome: contract ? (viewerWon ? "WON" : "LOST") : "PASSED OUT",
				compactDetail,
				countdown,
			},
			nextBoard: nextBoard(),
		};
	}
	const turn = view.turn as Seat;
	const bids = legal.flatMap((action): BidView[] =>
		action.type === "call"
			? [{ call: action.call, text: t(callText(action.call)) }]
			: [],
	);
	if (view.phase === "auction") {
		return {
			...common,
			phase: "auction",
			yourTurn: canAct && actionWait === undefined && turn === seat,
			heading: t("AUCTION"),
			bids,
			prompt: actionWait ?? t("{seat} to bid", { seat: t(SEAT_NAMES[turn]) }),
			waiting: actionWait ?? "",
		};
	}
	const actor = view.actor as Seat;
	const fromDummy = turn === dummy;
	let prompt: string;
	if (actionWait !== undefined) prompt = actionWait;
	else if (actor === seat)
		prompt = fromDummy
			? t("Your turn: play a card from dummy.")
			: t("Your turn to play.");
	else if (fromDummy)
		prompt = t("Waiting for {seat} to play from dummy.", {
			seat: t(SEAT_NAMES[actor]),
		});
	else prompt = t("Waiting for {seat} to play.", { seat: t(SEAT_NAMES[turn]) });
	return {
		...common,
		phase: "play",
		yourTurn: canAct && actionWait === undefined && actor === seat,
		prompt,
		waiting: actionWait ?? "",
	};
}
