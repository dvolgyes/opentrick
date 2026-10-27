import { expect, it } from "vitest";
import {
	communityGameFragment,
	parseCommunityRoute,
	partyFragment,
} from "../../src/community/link";

const key = "AAAAAAAAAAAAAAAAAAAAAA";

it("keeps community party and game routes separate from private game links", () => {
	expect(parseCommunityRoute(`#k=${key}`)).toBeUndefined();
	expect(parseCommunityRoute("#community")).toEqual({ kind: "create" });
	expect(
		parseCommunityRoute(partyFragment(key, "member_aaa", ["N", "S"])),
	).toEqual({ kind: "party", key, owner: "member_aaa", seats: ["N", "S"] });
	expect(parseCommunityRoute(communityGameFragment(key))).toEqual({
		kind: "game",
		key,
	});
});

it("rejects ambiguous modes, duplicate seats, invalid identities and extra credentials", () => {
	for (const hash of [
		`#community-game=${key}&k=${key}`,
		`#community-game=${key}&community=${key}`,
		`#community=${key}&owner=member_aaa&seats=NN`,
		`#community=${key}&owner=bad&seats=NS`,
		`#community=${key}&owner=member_aaa&seats=NX`,
		`#community=${key}&owner=member_aaa&seats=NS&seats=EW`,
	])
		expect(parseCommunityRoute(hash)).toEqual({ kind: "invalid" });
});

it("preserves friend names and seat choices in invitations and rejects choices on a reserved seat", () => {
	const setup = {
		names: { N: "Alice", S: "Bob" },
		open: { E: "bot", W: "both" } as const,
		waitMs: 120_000,
	};
	expect(
		parseCommunityRoute(partyFragment(key, "member_aaa", ["N", "S"], setup)),
	).toEqual({
		kind: "party",
		key,
		owner: "member_aaa",
		seats: ["N", "S"],
		setup,
	});
	expect(
		parseCommunityRoute(
			partyFragment(key, "member_aaa", ["N", "S"], {
				...setup,
				open: { N: "bot" },
			}),
		),
	).toEqual({ kind: "invalid" });
});
