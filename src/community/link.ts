import { isTableKey } from "../p2p/link";
import { isObject, isPlayerName, isSeat, type Seat } from "../protocol";
import { MAX_WAIT_MS, type OpenSeats, validId, validOpen } from "./formation";

export interface PartySetup {
	readonly open: OpenSeats;
	readonly names: Readonly<Partial<Record<Seat, string>>>;
	readonly waitMs: number;
}

export type CommunityRoute =
	| { readonly kind: "create" }
	| {
			readonly kind: "party";
			readonly key: string;
			readonly owner: string;
			readonly seats: readonly Seat[];
			readonly setup?: PartySetup;
			readonly member?: string;
	  }
	| {
			readonly kind: "game";
			readonly key: string;
			readonly member?: string;
			readonly seat?: Seat;
	  }
	| { readonly kind: "invalid" };

/** Separate fragments make older clients refuse community rooms instead of joining under private-game rules. */
export function parseCommunityRoute(hash: string): CommunityRoute | undefined {
	if (hash === "#community") return { kind: "create" };
	const params = new URLSearchParams(hash.replace(/^#/, ""));
	if (!params.has("community") && !params.has("community-game"))
		return undefined;
	const member = params.get("member");
	if (member !== null && !validId(member)) return { kind: "invalid" };
	const seat = params.get("seat");
	if (seat !== null && !isSeat(seat)) return { kind: "invalid" };
	const personal = member === null ? {} : { member };
	if (params.has("community-game")) {
		const key = params.get("community-game");
		return params.size ===
			1 + (member === null ? 0 : 1) + (seat === null ? 0 : 1) && isTableKey(key)
			? { kind: "game", key, ...personal, ...(seat === null ? {} : { seat }) }
			: { kind: "invalid" };
	}
	if (seat !== null) return { kind: "invalid" };
	const key = params.get("community");
	const owner = params.get("owner");
	const seats = [...(params.get("seats") ?? "")];
	let setup: PartySetup | undefined;
	const text = params.get("setup");
	if (text !== null) {
		if (text.length > 2048) return { kind: "invalid" };
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch (error) {
			if (error instanceof SyntaxError) return { kind: "invalid" };
			throw error;
		}
		if (
			!isObject(raw) ||
			!validOpen(raw.open) ||
			!isObject(raw.names) ||
			Object.entries(raw.names).some(
				([seat, name]) =>
					!isSeat(seat) || !seats.includes(seat) || !isPlayerName(name),
			) ||
			Object.keys(raw.open).some((seat) => seats.includes(seat)) ||
			typeof raw.waitMs !== "number" ||
			!Number.isFinite(raw.waitMs) ||
			raw.waitMs < 0 ||
			raw.waitMs > MAX_WAIT_MS
		)
			return { kind: "invalid" };
		setup = {
			open: raw.open,
			names: raw.names as Partial<Record<Seat, string>>,
			waitMs: raw.waitMs,
		};
	}
	return params.size === (setup ? 4 : 3) + (member === null ? 0 : 1) &&
		isTableKey(key) &&
		validId(owner) &&
		seats.length > 0 &&
		seats.length <= 4 &&
		seats.every(isSeat) &&
		new Set(seats).size === seats.length
		? {
				kind: "party",
				key,
				owner,
				seats,
				...(setup ? { setup } : {}),
				...personal,
			}
		: { kind: "invalid" };
}

export function partyFragment(
	key: string,
	owner: string,
	seats: readonly Seat[],
	setup?: PartySetup,
	member?: string,
): string {
	return `#${new URLSearchParams({ community: key, owner, seats: seats.join(""), ...(setup ? { setup: JSON.stringify(setup) } : {}), ...(member ? { member } : {}) })}`;
}

export function communityGameFragment(
	key: string,
	member?: string,
	seat?: Seat,
): string {
	return `#${new URLSearchParams({ "community-game": key, ...(member ? { member } : {}), ...(seat ? { seat } : {}) })}`;
}
