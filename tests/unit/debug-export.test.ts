import { describe, expect, it } from "vitest";
import { debugExport, pageAddress } from "../../src/ui/debug-export";

const BUILD = { commit: "1d12f39", date: "2026-10-24T13:29:07+02:00" };
const OLD = { commit: "f7812e8", date: "2026-10-20T09:00:00+02:00" };

describe("the host's debug export", () => {
	it("gives each seat the host's page, a player's report, a bot, or a missing report", () => {
		const exported = debugExport({
			exportedAt: Date.UTC(2026, 9, 24, 12, 0),
			build: BUILD,
			page: "https://example.test/opentrick/",
			hostSeat: "N",
			host: { form: "desktop" },
			bots: ["S", "E"],
			reports: [
				{
					seat: "E",
					build: OLD,
					detail: { form: "desktop", window: { innerHeight: 800 } },
					receivedAt: Date.UTC(2026, 9, 24, 11, 59),
				},
			],
			asked: 2,
			view: { hosting: true },
			entries: [{ seq: 1 }],
		});
		expect(exported).toEqual({
			kind: "opentrick-debug-export",
			version: 1,
			exportedAt: "2026-10-24T12:00:00.000Z",
			build: BUILD,
			page: "https://example.test/opentrick/",
			asked: 2,
			seats: [
				{
					seat: "N",
					source: "host",
					build: BUILD,
					detail: { form: "desktop" },
				},
				{
					seat: "E",
					source: "player",
					build: OLD,
					receivedAt: "2026-10-24T11:59:00.000Z",
					detail: { form: "desktop", window: { innerHeight: 800 } },
				},
				{ seat: "S", source: "bot" },
				{ seat: "W", source: "missing" },
			],
			view: { hosting: true },
			entries: [{ seq: 1 }],
		});
	});

	it("names the page without its fragment, which holds the table key, or its query", () => {
		expect(
			pageAddress("https://example.test/opentrick/?n=Ann&b=E#k=secret"),
		).toBe("https://example.test/opentrick/");
	});
});
