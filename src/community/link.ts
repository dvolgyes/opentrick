import { isTableKey } from "../p2p/link";
import { isSeat, type Seat } from "../protocol";
import { validId } from "./formation";

export type CommunityRoute =
	| { readonly kind: "create" }
	| {
			readonly kind: "party";
			readonly key: string;
			readonly owner: string;
			readonly seats: readonly Seat[];
	  }
	| { readonly kind: "game"; readonly key: string }
	| { readonly kind: "invalid" };

/** Separate fragments make older clients refuse community rooms instead of joining under private-game rules. */
export function parseCommunityRoute(hash: string): CommunityRoute | undefined {
	if (hash === "#community") return { kind: "create" };
	const params = new URLSearchParams(hash.replace(/^#/, ""));
	if (!params.has("community") && !params.has("community-game"))
		return undefined;
	if (params.has("community-game")) {
		const key = params.get("community-game");
		return params.size === 1 && isTableKey(key)
			? { kind: "game", key }
			: { kind: "invalid" };
	}
	const key = params.get("community");
	const owner = params.get("owner");
	const seats = [...(params.get("seats") ?? "")];
	return params.size === 3 &&
		isTableKey(key) &&
		validId(owner) &&
		seats.length > 0 &&
		seats.length <= 4 &&
		seats.every(isSeat) &&
		new Set(seats).size === seats.length
		? { kind: "party", key, owner, seats }
		: { kind: "invalid" };
}

export function partyFragment(
	key: string,
	owner: string,
	seats: readonly Seat[],
): string {
	return `#${new URLSearchParams({ community: key, owner, seats: seats.join("") })}`;
}

export function communityGameFragment(key: string): string {
	return `#community-game=${key}`;
}
