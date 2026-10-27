import { UPDATE_DATE_PARAM } from "../build";
import { type PlayerProfiles, playerName } from "../players";
import {
	type BotSetup,
	DEFAULT_BOT_SETUP,
	isSeat,
	type LocalBidder,
	parseBotSetup,
	type RoomConfig,
	SEATS,
	type Seat,
} from "../protocol";

/** The seat of a page's own URL. A link without it reopens the seat that this browser remembers. */
export const SELECTED_PLAYER_PARAM = "pl";

/**
 * Query keys of the four seats, one letter each, as in `?e=zsdh&w=dvolgyes`. The query never carries the table key:
 * that stays in the fragment.
 */
export const SEAT_PARAM: Readonly<Record<Seat, string>> = {
	N: "n",
	E: "e",
	S: "s",
	W: "w",
};

/** The seat of the creator, as a seat letter. */
const HOST_PARAM = "h";
/** The bot seats, as seat letters in seat order, such as `ESW`. */
const BOT_SEATS_PARAM = "b";
/** The bidding engine; the default is left out of the query. */
const BIDDER_PARAM = "r";
const BOT_SETUP_PARAMS = [BOT_SEATS_PARAM, BIDDER_PARAM] as const;

export interface Bookmark {
	/** Prefilled names; a seat is absent when its value is missing, empty, or too long. */
	readonly names: Partial<Record<Seat, string>>;
	/** The seat the creator takes; absent when the value is missing or unknown. */
	readonly host?: Seat;
	readonly botSetup?: BotSetup;
}

export interface RoomSetup {
	readonly config: RoomConfig;
	readonly host: Seat;
}

/**
 * Reads a bookmark from a query string. The values come from the address bar, so they are untrusted: each name is
 * trimmed and length-checked, and each seat must be one of the four. Anything else is ignored, not an error.
 */
export function parseBookmark(search: string): Bookmark {
	const params = new URLSearchParams(search);
	const names: Partial<Record<Seat, string>> = {};
	for (const seat of SEATS) {
		const name = playerName(params.get(SEAT_PARAM[seat]));
		if (name !== undefined) names[seat] = name;
	}
	const host = readHost(params);
	const botSetup = parseBotSetupParams(params);
	return {
		names,
		...(host === undefined ? {} : { host }),
		...(botSetup === undefined ? {} : { botSetup }),
	};
}

function readHost(params: URLSearchParams): Seat | undefined {
	const letter = params.get(HOST_PARAM);
	if (letter === null) return undefined;
	return isSeat(letter) ? letter : undefined;
}

/** Reads the complete setup needed to start a room from a shared link. */
export function parseRoomSetup(search: string): RoomSetup | undefined {
	const bookmark = parseBookmark(search);
	if (bookmark.host === undefined) return undefined;
	const names = {} as Record<Seat, string>;
	for (const seat of SEATS) {
		const name = bookmark.names[seat];
		if (name === undefined) return undefined;
		names[seat] = name;
	}
	const botSetup = bookmark.botSetup;
	const params = new URLSearchParams(search);
	if (hasBotSetupParams(params) && bookmark.botSetup === undefined)
		return undefined;
	return {
		config: {
			names,
			scoring: "duplicate",
			...(botSetup === undefined ? {} : { botSetup }),
		},
		host: bookmark.host,
	};
}

/**
 * Reads the seat of a page's own URL: a seat, or undefined when the page may choose its own seat. A URL without `pl`
 * gives undefined, so the page reopens the remembered seat. Invalid or repeated values also give undefined.
 */
export function parseSelectedPlayer(search: string): Seat | undefined {
	const values = new URLSearchParams(search).getAll(SELECTED_PLAYER_PARAM);
	if (values.length !== 1) return undefined;
	return isSeat(values[0]) ? values[0] : undefined;
}

/** The query of a link to share: the room values of `search`, with no seat selected. */
export function sharedQuery(search: string, players?: PlayerProfiles): string {
	const params = new URLSearchParams(search);
	params.delete(UPDATE_DATE_PARAM);
	params.delete(SELECTED_PLAYER_PARAM);
	if (players)
		for (const seat of SEATS)
			params.set(
				SEAT_PARAM[seat],
				players[seat].askOnEntry ? "player" : players[seat].name,
			);
	return params.toString();
}

/** Adds the selected seat to the current query while preserving other room or bookmark values. */
export function selectedPlayerQuery(search: string, seat: Seat): string {
	const params = new URLSearchParams(search);
	params.set(SELECTED_PLAYER_PARAM, seat);
	return params.toString();
}

const AUTOPLAY_SEATS_PARAM = "autoplay_seats";

/**
 * Replaces the bot-seat snapshot in a room URL while preserving player, model, and selection parameters.
 * `autoplay` names the bot seats whose players asked for the bot; the query keeps only those that are also in `bots`.
 */
export function botSeatsQuery(
	search: string,
	bots: readonly Seat[],
	autoplay: readonly Seat[] = [],
): string {
	const params = new URLSearchParams(search);
	const selected = new Set(bots);
	params.set(
		BOT_SEATS_PARAM,
		SEATS.filter((seat) => selected.has(seat)).join(""),
	);
	const delegated = SEATS.filter(
		(seat) => selected.has(seat) && autoplay.includes(seat),
	);
	if (delegated.length === 0) params.delete(AUTOPLAY_SEATS_PARAM);
	else params.set(AUTOPLAY_SEATS_PARAM, delegated.join(","));
	return params.toString();
}

/** The seats of `autoplay_seats` in seat order; the value is untrusted, so an unknown or repeated entry is ignored. */
export function parseAutoplaySeats(search: string): Seat[] {
	const values =
		new URLSearchParams(search).get(AUTOPLAY_SEATS_PARAM)?.split(",") ?? [];
	return SEATS.filter((seat) => values.includes(seat));
}

/** The query of a bookmark for a table: the four names, the creator's seat, and the bot setup when there is one. */
export function bookmarkQuery(
	names: Readonly<Record<Seat, string>>,
	host: Seat,
	botSetup?: BotSetup,
): string {
	const params = new URLSearchParams();
	for (const seat of SEATS) params.set(SEAT_PARAM[seat], names[seat]);
	params.set(HOST_PARAM, host);
	if (botSetup !== undefined) {
		params.set(BOT_SEATS_PARAM, botSetup.seats.join(""));
		if (botSetup.bidder !== DEFAULT_BOT_SETUP.bidder)
			params.set(BIDDER_PARAM, botSetup.bidder);
	}
	return params.toString();
}

function hasBotSetupParams(params: URLSearchParams): boolean {
	return BOT_SETUP_PARAMS.some((name) => params.has(name));
}

/** The seats of a text such as `ESW` or `E,S,W`; undefined when a letter is not a seat or a seat repeats. */
function readSeatLetters(text: string): Seat[] | undefined {
	const letters = [...text.replaceAll(",", "").toUpperCase()];
	const seats = SEATS.filter((seat) => letters.includes(seat));
	return seats.length === letters.length ? seats : undefined;
}

/** The bot seats that a room URL stores, or undefined when it stores none. */
export function storedBotSeats(search: string): Seat[] | undefined {
	const text = new URLSearchParams(search).get(BOT_SEATS_PARAM);
	if (text === null) return undefined;
	return readSeatLetters(text) ?? [];
}

/** The query of a room URL with the bidding engine of this table's bots; the default is left out. */
export function bidderQuery(search: string, bidder: LocalBidder): string {
	const params = new URLSearchParams(search);
	if (bidder === DEFAULT_BOT_SETUP.bidder) params.delete(BIDDER_PARAM);
	else params.set(BIDDER_PARAM, bidder);
	return params.toString();
}

function parseBotSetupParams(params: URLSearchParams): BotSetup | undefined {
	if (!hasBotSetupParams(params)) return undefined;
	if (BOT_SETUP_PARAMS.some((name) => params.getAll(name).length > 1))
		return undefined;
	const seatsText = params.get(BOT_SEATS_PARAM);
	const seats = seatsText === null ? [] : readSeatLetters(seatsText);
	if (seats === undefined) return undefined;
	return parseBotSetup({
		seats,
		bidder: params.get(BIDDER_PARAM) ?? DEFAULT_BOT_SETUP.bidder,
	});
}
