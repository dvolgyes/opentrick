import { describe, expect, it } from "vitest";
import { initialPlayers } from "../../src/players";
import {
	bookmarkQuery,
	botSeatsQuery,
	parseAutoplaySeats,
	parseBookmark,
	parseRoomSetup,
	parseSelectedPlayer,
	selectedPlayerQuery,
	sharedQuery,
} from "../../src/ui/bookmark";

describe("parseBookmark", () => {
	it("normalizes Unicode names and refuses control characters from a link", () => {
		expect(
			parseBookmark(
				`?n=${encodeURIComponent("Céline")}&e=${encodeURIComponent("Alice\nBob")}`,
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
			sharedQuery("?n=old&h=S&pl=N&update_to=2026-10-26T12:00:00Z", profiles),
		);
		expect(query.get("e")).toBe("Dana");
		expect(query.get("w")).toBe("player");
		expect(query.get("h")).toBe("S");
		expect(query.has("pl")).toBe(false);
		expect(query.has("update_to")).toBe(false);
	});
	it("reads the four names and the host seat by letter", () => {
		expect(parseBookmark("?n=ann&e=zsdh&s=bo&w=dvolgyes&h=W")).toEqual({
			names: { N: "ann", E: "zsdh", S: "bo", W: "dvolgyes" },
			host: "W",
		});
	});

	it("still reads the names and the host seat of earlier links", () => {
		expect(
			parseBookmark("?north=ann&east=zsdh&south=bo&west=dvolgyes&host=west"),
		).toEqual({
			names: { N: "ann", E: "zsdh", S: "bo", W: "dvolgyes" },
			host: "W",
		});
	});

	it("trims names and drops empty ones", () => {
		expect(parseBookmark("?e=%20%20zsdh%20&w=%20")).toEqual({
			names: { E: "zsdh" },
		});
	});

	it("drops a name longer than 40 characters, counting characters not bytes", () => {
		const forty = "é".repeat(40);
		expect(parseBookmark(`?e=${forty}`).names).toEqual({ E: forty });
		expect(parseBookmark(`?e=${forty}x`).names).toEqual({});
	});

	it("ignores unknown keys, seat letters and other values", () => {
		expect(parseBookmark("?E=zsdh&hostseat=east&h=up&S=bo&room=1")).toEqual({
			names: {},
		});
	});

	it("keeps the first value of a repeated key", () => {
		expect(parseBookmark("?e=first&e=second").names).toEqual({
			E: "first",
		});
	});

	it("reads an empty query as no prefill", () => {
		expect(parseBookmark("")).toEqual({ names: {} });
	});
});

describe("bookmarkQuery", () => {
	it("updates the bot-seat snapshot without changing other room settings", () => {
		const query = botSeatsQuery("?n=North&e=East&h=W&b=N&r=rl-fsp&pl=W", [
			"W",
			"E",
		]);
		const params = new URLSearchParams(query);
		expect(params.get("b")).toBe("EW");
		expect(params.get("r")).toBe("rl-fsp");
		expect(params.get("pl")).toBe("W");
		expect(params.get("n")).toBe("North");
		expect(params.has("autoplay_seats")).toBe(false);
	});

	it("replaces the bot seats of an earlier link with the letter form", () => {
		const query = botSeatsQuery("?north=N&bot_seats=N&bot_bidder=rl-fsp", [
			"S",
		]);
		const params = new URLSearchParams(query);
		expect(params.get("b")).toBe("S");
		expect(params.has("bot_seats")).toBe(false);
		expect(params.get("bot_bidder")).toBe("rl-fsp");
	});

	it("keeps the bot seats whose players asked for autoplay, among the bot seats only", () => {
		const query = botSeatsQuery("?b=N", ["W", "E"], ["S", "E"]);
		expect(new URLSearchParams(query).get("autoplay_seats")).toBe("E");
		expect(parseAutoplaySeats(`?${query}`)).toEqual(["E"]);
	});

	it("writes the names by letter and the host seat by letter", () => {
		const query = bookmarkQuery(
			{ N: "player1", E: "zsdh", S: "player2", W: "dvolgyes" },
			"E",
		);
		expect(query).toBe("n=player1&e=zsdh&s=player2&w=dvolgyes&h=E");
	});

	it("encodes initial bot seats, and leaves out the default bidding engine", () => {
		const query = bookmarkQuery(
			{ N: "player1", E: "player3", S: "player2", W: "player4" },
			"W",
			{
				seats: ["N", "W"],
				bidder: "sl",
			},
		);
		expect(query).toContain("b=NW");
		expect(query).not.toContain("r=");
		expect(query).not.toMatch(/api.?key|secret/i);
		expect(parseRoomSetup(`?${query}`)?.config.botSetup).toEqual({
			seats: ["N", "W"],
			bidder: "sl",
		});
	});

	it("writes a bidding engine that is not the default", () => {
		const query = bookmarkQuery({ N: "a", E: "b", S: "c", W: "d" }, "N", {
			seats: [],
			bidder: "rl-fsp",
		});
		expect(query).toContain("&b=&r=rl-fsp");
		expect(parseRoomSetup(`?${query}`)?.config.botSetup).toEqual({
			seats: [],
			bidder: "rl-fsp",
		});
	});

	it("reads the bot setup of an earlier link", () => {
		expect(
			parseRoomSetup(
				"?north=a&east=b&south=c&west=d&host=west&bot_seats=E,S,W&bot_bidder=sl",
			)?.config.botSetup,
		).toEqual({ seats: ["E", "S", "W"], bidder: "sl" });
	});

	it("round-trips through parseBookmark, including characters that need escaping", () => {
		const names = { N: "a&b=c", E: "x y", S: "é+ü", W: "#1" };
		expect(parseBookmark(`?${bookmarkQuery(names, "S")}`)).toEqual({
			names,
			host: "S",
		});
	});
});

describe("the pl parameter", () => {
	it("reads a seat, and reads no seat as null", () => {
		expect(parseSelectedPlayer("pl=W")).toBe("W");
		expect(parseSelectedPlayer("")).toBeNull();
		expect(parseSelectedPlayer("n=a&h=W")).toBeNull();
	});

	it("reads anything else as no choice", () => {
		for (const search of ["pl=", "pl=X", "pl=w", "pl=W&pl=E"])
			expect(parseSelectedPlayer(search), search).toBeUndefined();
	});

	it("still reads the selected_player of earlier links, where none means no seat", () => {
		expect(parseSelectedPlayer("selected_player=W")).toBe("W");
		expect(parseSelectedPlayer("selected_player=none")).toBeNull();
		expect(parseSelectedPlayer("selected_player=none&selected_player=W")).toBe(
			undefined,
		);
	});

	it("is left out of a shared query, which keeps every other value", () => {
		expect(sharedQuery("n=a&h=W&pl=W&b=N")).toBe("n=a&h=W&b=N");
		expect(sharedQuery("n=a")).toBe("n=a");
		expect(parseSelectedPlayer(sharedQuery("pl=E"))).toBeNull();
	});

	it("is replaced by the seat of the page", () => {
		expect(selectedPlayerQuery("n=a&pl=E", "S")).toBe("n=a&pl=S");
	});
});
