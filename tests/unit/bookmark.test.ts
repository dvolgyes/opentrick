import { describe, expect, it } from "vitest";
import { initialPlayers } from "../../src/players";
import {
	bookmarkQuery,
	botSeatsQuery,
	parseAutoplaySeats,
	parseBookmark,
	parseRoomSetup,
	parseSelectedPlayer,
	sharedQuery,
} from "../../src/ui/bookmark";

describe("parseBookmark", () => {
	it("normalizes Unicode names and refuses control characters from a link", () => {
		expect(
			parseBookmark(
				`?north=${encodeURIComponent("Ce\u0301line")}&east=${encodeURIComponent("Alice\nBob")}`,
			),
		).toEqual({ names: { N: "Céline" } });
	});
	it("shares current fixed names and self-naming markers without a reload-attempt flag", () => {
		const profiles = {
			...initialPlayers({
				scoring: "duplicate",
				names: { N: "North", E: "East", S: "South", W: "West" },
			}),
			E: { name: "Dana", askOnEntry: false, rev: 2 },
			W: { name: "Alice", askOnEntry: true, rev: 3 },
		};
		const query = new URLSearchParams(
			sharedQuery(
				"?north=old&host=south&selected_player=N&update_to=2026-10-26T12:00:00Z",
				profiles,
			),
		);
		expect(query.get("east")).toBe("Dana");
		expect(query.get("west")).toBe("player");
		expect(query.get("host")).toBe("south");
		expect(query.get("selected_player")).toBe("none");
		expect(query.has("update_to")).toBe(false);
	});
	it("reads the four names and the host seat by direction", () => {
		expect(
			parseBookmark("?north=ann&east=zsdh&south=bo&west=dvolgyes&host=west"),
		).toEqual({
			names: { N: "ann", E: "zsdh", S: "bo", W: "dvolgyes" },
			host: "W",
		});
	});

	it("trims names and drops empty ones", () => {
		expect(parseBookmark("?east=%20%20zsdh%20&west=%20")).toEqual({
			names: { E: "zsdh" },
		});
	});

	it("drops a name longer than 40 characters, counting characters not bytes", () => {
		const forty = "é".repeat(40);
		expect(parseBookmark(`?east=${forty}`).names).toEqual({ E: forty });
		expect(parseBookmark(`?east=${forty}x`).names).toEqual({});
	});

	it("ignores unknown keys, seat letters and other values", () => {
		expect(
			parseBookmark("?E=zsdh&hostseat=east&host=up&SOUTH=bo&room=1"),
		).toEqual({ names: {} });
	});

	it("keeps the first value of a repeated key", () => {
		expect(parseBookmark("?east=first&east=second").names).toEqual({
			E: "first",
		});
	});

	it("reads an empty query as no prefill", () => {
		expect(parseBookmark("")).toEqual({ names: {} });
	});
});

describe("bookmarkQuery", () => {
	it("updates the bot-seat snapshot without changing other room settings", () => {
		const query = botSeatsQuery(
			"?north=North&east=East&host=west&bot_seats=N&bot_bidder=rl-fsp&selected_player=W",
			["W", "E"],
		);
		const params = new URLSearchParams(query);
		expect(params.get("bot_seats")).toBe("E,W");
		expect(params.get("bot_bidder")).toBe("rl-fsp");
		expect(params.get("selected_player")).toBe("W");
		expect(params.get("north")).toBe("North");
		expect(params.has("autoplay_seats")).toBe(false);
	});

	it("keeps the bot seats whose players asked for autoplay, among the bot seats only", () => {
		const query = botSeatsQuery("?bot_seats=N", ["W", "E"], ["S", "E"]);
		expect(new URLSearchParams(query).get("autoplay_seats")).toBe("E");
		expect(parseAutoplaySeats(`?${query}`)).toEqual(["E"]);
	});

	it("writes the names by direction and the host seat", () => {
		const query = bookmarkQuery(
			{ N: "player1", E: "zsdh", S: "player2", W: "dvolgyes" },
			"E",
		);
		expect(query).toBe(
			"north=player1&east=zsdh&south=player2&west=dvolgyes&host=east",
		);
	});

	it("encodes initial bot seats and the local bidding policy", () => {
		const query = bookmarkQuery(
			{ N: "player1", E: "player3", S: "player2", W: "player4" },
			"W",
			{
				seats: ["W"],
				bidder: "sl",
			},
		);
		expect(query).toContain("bot_seats=W");
		expect(query).toContain("bot_bidder=sl");
		expect(query).not.toMatch(/api.?key|secret/i);
		expect(parseRoomSetup(`?${query}`)?.config.botSetup).toEqual({
			seats: ["W"],
			bidder: "sl",
		});
	});

	it("round-trips through parseBookmark, including characters that need escaping", () => {
		const names = { N: "a&b=c", E: "x y", S: "é+ü", W: "#1" };
		expect(parseBookmark(`?${bookmarkQuery(names, "S")}`)).toEqual({
			names,
			host: "S",
		});
	});
});

describe("the selected_player parameter", () => {
	it("reads a seat, none as null, and anything else as no choice", () => {
		expect(parseSelectedPlayer("selected_player=W")).toBe("W");
		expect(parseSelectedPlayer("selected_player=none")).toBeNull();
		for (const search of [
			"",
			"selected_player=",
			"selected_player=X",
			"selected_player=w",
			"selected_player=none&selected_player=W",
		])
			expect(parseSelectedPlayer(search), search).toBeUndefined();
	});

	it("is none in a shared query, which keeps every other value", () => {
		expect(sharedQuery("north=a&host=west&selected_player=W&bot_seats=N")).toBe(
			"north=a&host=west&selected_player=none&bot_seats=N",
		);
		expect(sharedQuery("north=a")).toBe("north=a&selected_player=none");
		expect(parseSelectedPlayer(sharedQuery("selected_player=E"))).toBeNull();
	});
});
