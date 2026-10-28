import { isTableKey } from "../p2p/link";
import type { SeatHolder } from "../p2p/wire";
import {
	isObject,
	isPlayerName,
	isSeat,
	type RoomConfig,
	SEATS,
	type Seat,
} from "../protocol";

export const REPLACEMENT_OFFER_TTL_MS = 20_000;

export interface ReplacementOffer {
	readonly key: string;
	readonly seat: Seat;
	readonly host: string;
	readonly receivedAt: number;
}

export function communityNextBoardReady(
	config: RoomConfig,
	seats: readonly SeatHolder[],
	online: ReadonlySet<Seat>,
): boolean {
	if (!config.community) return true;
	return SEATS.every((seat) => {
		if (config.community?.holders[seat] === undefined || online.has(seat))
			return true;
		return seats.find((row) => row.seat === seat)?.communityBot === true;
	});
}

export function parseReplacementOffer(
	value: unknown,
	now: number,
): ReplacementOffer | undefined {
	if (
		!isObject(value) ||
		value.k !== "replacement-offer" ||
		!isTableKey(value.key) ||
		!isSeat(value.seat) ||
		!isPlayerName(value.host)
	)
		return undefined;
	return {
		key: value.key,
		seat: value.seat,
		host: value.host,
		receivedAt: now,
	};
}
