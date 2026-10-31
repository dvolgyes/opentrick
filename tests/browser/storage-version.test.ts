import { beforeEach, describe, expect, it } from "vitest";
import { guardedStorage } from "../../src/session";
import { dropOldGameData } from "../../src/storage-version";

// The tests use the Web Storage of this page in Chrome. Vitest does not keep it, so the tests clear it.
beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

const VERSION_KEY = "opentrick.storage-version";

const GAME_DATA: Record<string, string> = {
	"opentrick.client.table1": "client",
	"opentrick.seat.table1": '{"seat":"N","savedAt":1}',
	"opentrick.host.table1": '{"seat":"N","savedAt":1}',
	"opentrick.community.room.key1.member1": "{}",
	"opentrick.community.transfers.member1": "[]",
};
const PREFERENCES: Record<string, string> = {
	"opentrick.locale": "de",
	"opentrick.player-name": "Anna",
	"opentrick.settings.theme": "dark",
	"opentrick.community.wait-minutes": "5",
};

function fill(): void {
	for (const [key, value] of Object.entries({ ...GAME_DATA, ...PREFERENCES }))
		localStorage.setItem(key, value);
	sessionStorage.setItem("opentrick.tab.table1", "N");
}

function drop(version: number): void {
	dropOldGameData(
		guardedStorage(() => localStorage),
		guardedStorage(() => sessionStorage),
		version,
	);
}

function stored(): Record<string, string | null> {
	return Object.fromEntries(
		[...Object.keys(GAME_DATA), ...Object.keys(PREFERENCES), VERSION_KEY].map(
			(key) => [key, localStorage.getItem(key)],
		),
	);
}

describe("storage version", () => {
	it("keeps the data of a browser without a stored version, which is version 1, and stores the version", () => {
		fill();
		const before = stored();
		drop(1);
		expect(stored()).toEqual({ ...before, [VERSION_KEY]: "1" });
		expect(sessionStorage.getItem("opentrick.tab.table1")).toBe("N");
	});

	it.each([
		["no stored version", null],
		["a lower stored version", "1"],
		["an unreadable stored version", "new"],
	])("drops the game data and keeps the preferences after %s", (_, version) => {
		fill();
		if (version !== null) localStorage.setItem(VERSION_KEY, version);
		drop(2);
		for (const key of Object.keys(GAME_DATA))
			expect(localStorage.getItem(key)).toBeNull();
		expect(sessionStorage.getItem("opentrick.tab.table1")).toBeNull();
		for (const [key, value] of Object.entries(PREFERENCES))
			expect(localStorage.getItem(key)).toBe(value);
		expect(localStorage.getItem(VERSION_KEY)).toBe("2");
	});

	it("drops nothing again once the version is stored", () => {
		localStorage.setItem(VERSION_KEY, "1");
		drop(2);
		fill();
		drop(2);
		expect(localStorage.getItem("opentrick.client.table1")).toBe("client");
	});

	it("keeps the data and the version of a newer build, so that an older page in another tab drops nothing", () => {
		fill();
		localStorage.setItem(VERSION_KEY, "3");
		const before = stored();
		drop(2);
		expect(stored()).toEqual(before);
		expect(sessionStorage.getItem("opentrick.tab.table1")).toBe("N");
	});

	it("does nothing without localStorage", () => {
		sessionStorage.setItem("opentrick.tab.table1", "N");
		dropOldGameData(
			undefined,
			guardedStorage(() => sessionStorage),
			2,
		);
		expect(sessionStorage.getItem("opentrick.tab.table1")).toBe("N");
	});
});
