import { expect, it } from "vitest";
import {
	communityNextBoardReady,
	parseReplacementOffer,
	REPLACEMENT_OFFER_TTL_MS,
} from "../../src/community/replacement";

const offer = {
	k: "replacement-offer",
	key: "AAAAAAAAAAAAAAAAAAAAAA",
	seat: "E",
	host: "Alice",
};

it("accepts a bounded discovery offer for a valid seat and table key", () => {
	expect(parseReplacementOffer(offer, 1_000)).toEqual({
		key: offer.key,
		seat: "E",
		host: "Alice",
		receivedAt: 1_000,
	});
	expect(REPLACEMENT_OFFER_TTL_MS).toBe(20_000);
});

it("rejects malformed replacement offers", () => {
	for (const value of [
		{ ...offer, key: "bad" },
		{ ...offer, seat: "X" },
		{ ...offer, host: "" },
		{ ...offer, k: "other" },
	]) {
		expect(parseReplacementOffer(value, 0)).toBeUndefined();
	}
});

it("waits for a replacement before the next board unless the host approved a permanent bot", () => {
	const config = {
		names: { N: "Host", E: "East", S: "South", W: "West" },
		scoring: "duplicate" as const,
		community: {
			v: 1 as const,
			holders: { N: "abcdefghijklmnop", E: "qrstuvwxyzABCDEF" },
		},
	};
	const seats = [
		{ seat: "N" as const, holder: "abcdefghijklmnop", gen: 1 },
		{ seat: "E" as const, holder: "qrstuvwxyzABCDEF", gen: 1, coverBoard: 4 },
	];
	expect(communityNextBoardReady(config, seats, new Set(["N"]))).toBe(false);
	expect(
		communityNextBoardReady(
			config,
			seats.map((row) =>
				row.seat === "E" ? { ...row, communityBot: true as const } : row,
			),
			new Set(["N"]),
		),
	).toBe(true);
	expect(communityNextBoardReady(config, seats, new Set(["N", "E"]))).toBe(
		true,
	);
});
