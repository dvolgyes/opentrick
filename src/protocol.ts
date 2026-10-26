/** Shared vocabulary of the room protocol. Every command payload, event and state carries `v` and `roomId`. */

export const PROTOCOL_VERSION = 1;
export const APPLICATION_FEATURES = {
	bridgeUndo: "bridge-undo-v1",
	bridgeClaim: "bridge-claim-v1",
	/** The page reads a claim of no tricks, which gives the defenders every remaining trick. */
	bridgeClaimNone: "bridge-claim-none-v1",
	/** The page reads a claim made while a defender is to play. */
	bridgeClaimAnyTurn: "bridge-claim-any-turn-v1",
	bridgeReset: "bridge-reset-v1",
} as const;

export const SEATS = ["N", "E", "S", "W"] as const;
export type Seat = (typeof SEATS)[number];

export const SEAT_NAMES: Readonly<Record<Seat, string>> = {
	N: "North",
	E: "East",
	S: "South",
	W: "West",
};

export const MAX_NAME_LENGTH = 40;

export function isPlayerName(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.trim() === value &&
		value.normalize("NFC") === value &&
		value.length > 0 &&
		Array.from(value).length <= MAX_NAME_LENGTH &&
		!/\p{Cc}/u.test(value)
	);
}

export type Scoring = "duplicate";

export const LOCAL_BIDDERS = ["sl", "rl-fsp"] as const;
export type LocalBidder = (typeof LOCAL_BIDDERS)[number];

export interface BotSetup {
	readonly bidder: LocalBidder;
	/** The bot seats when the room is first created. */
	readonly seats: readonly Seat[];
}

/** The WBridge5 imitation bids a natural system that human partners and opponents can read; RL/FSP stays selectable. */
export const DEFAULT_BOT_SETUP: BotSetup = {
	seats: [],
	bidder: "sl",
};

export interface RoomConfig {
	readonly names: Readonly<Record<Seat, string>>;
	readonly scoring: Scoring;
	/** Optional for rooms created by older app versions. */
	readonly botSetup?: BotSetup;
}

export type JsonObject = { [key: string]: unknown };

export function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSeat(value: unknown): value is Seat {
	return (
		typeof value === "string" && (SEATS as readonly string[]).includes(value)
	);
}

/** Older setup links identify automated players by name; explicit bot flags take priority in new rooms. */
export function isBotName(name: string): boolean {
	return /bot|robot/i.test(name);
}

export function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseRoomConfig(value: unknown): RoomConfig | undefined {
	if (!isObject(value) || !isObject(value.names)) return undefined;
	const names: Partial<Record<Seat, string>> = {};
	for (const seat of SEATS) {
		const name = value.names[seat];
		if (!isPlayerName(name)) return undefined;
		names[seat] = name;
	}
	const { scoring } = value;
	if (scoring !== "duplicate") return undefined;
	let botSetup: BotSetup | undefined;
	if (Object.hasOwn(value, "botSetup")) {
		const parsedBotSetup = parseBotSetup(value.botSetup);
		if (parsedBotSetup === undefined) return undefined;
		botSetup = parsedBotSetup;
	}
	return {
		names: names as Record<Seat, string>,
		scoring,
		...(botSetup === undefined ? {} : { botSetup }),
	};
}

export function parseBotSetup(value: unknown): BotSetup | undefined {
	if (!isObject(value)) return undefined;
	if (
		value.bidder !== undefined &&
		value.bidder !== "sl" &&
		value.bidder !== "rl-fsp"
	)
		return undefined;
	const { seats } = value;
	if (
		!Array.isArray(seats) ||
		!seats.every(isSeat) ||
		new Set(seats).size !== seats.length ||
		seats.length > SEATS.length
	)
		return undefined;
	return {
		seats: [...seats],
		bidder: value.bidder ?? DEFAULT_BOT_SETUP.bidder,
	};
}

export interface EventEnvelope {
	readonly roomId: string;
	readonly seq: number;
	readonly commandId: string;
	readonly fromSeat: Seat;
}

/** Envelope fields win over body fields, so a game module cannot forge sender, room or order. */
export function envelopeEvent(
	envelope: EventEnvelope,
	body: JsonObject,
): JsonObject {
	return {
		...body,
		v: PROTOCOL_VERSION,
		roomId: envelope.roomId,
		type: "event",
		seq: envelope.seq,
		commandId: envelope.commandId,
		fromSeat: envelope.fromSeat,
	};
}

/** The seat `steps` places clockwise from `seat`. */
export function seatAfter(seat: Seat, steps: number): Seat {
	return SEATS[(SEATS.indexOf(seat) + steps) % 4] as Seat;
}

export function seatLabel(config: RoomConfig, seat: Seat): string {
	return `${SEAT_NAMES[seat]} — ${config.names[seat]}`;
}
