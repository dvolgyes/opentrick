import { describe, expect, it } from "vitest";
import {
	formatBuildDate,
	isBuildInfo,
	newerBuildDate,
	updateUrl,
} from "../../src/build";

describe("reconnect update", () => {
	it("compares only the Git date, normalizing offsets and refusing invalid dates", () => {
		expect(
			newerBuildDate("2026-10-24T12:00:00Z", "2026-10-24T14:00:00+02:00"),
		).toBe(false);
		expect(newerBuildDate("2026-10-24T12:00:00Z", "2026-10-25T00:00:00Z")).toBe(
			true,
		);
		expect(newerBuildDate("unknown", "2026-10-25T00:00:00Z")).toBe(false);
		expect(newerBuildDate("2026-10-24T12:00:00Z", "javascript:alert(1)")).toBe(
			false,
		);
	});
	it("keeps the origin, room fragment, setup and selected seat, with one attempt per newer date", () => {
		const local = "2026-10-24T12:00:00Z";
		const remote = "2026-10-25T12:00:00Z";
		const page =
			"https://example.org/opentrick/?host=south&selected_player=S#v=p2p-v1&k=secret";
		const updated = updateUrl(page, local, remote);
		expect(updated).toBeDefined();
		const url = new URL(updated ?? "");
		expect(url.origin).toBe("https://example.org");
		expect(url.pathname).toBe("/opentrick/");
		expect(url.hash).toBe("#v=p2p-v1&k=secret");
		expect(url.searchParams.get("selected_player")).toBe("S");
		expect(updateUrl(url.toString(), local, remote)).toBeUndefined();
		expect(updateUrl(page, remote, local)).toBeUndefined();
	});
});

describe("formatBuildDate", () => {
	it("shows the commit time as a short date with the 24-hour time", () => {
		expect(formatBuildDate("2026-10-24T13:49:07+00:00", "UTC")).toBe(
			"Oct 24,'26, 13:49",
		);
	});

	it("shows the time in the given time zone", () => {
		expect(
			formatBuildDate("2026-10-24T13:29:07+02:00", "Europe/Budapest"),
		).toBe("Oct 24,'26, 13:29");
		expect(formatBuildDate("2026-01-05T23:05:00Z", "Europe/Budapest")).toBe(
			"Jan 6,'26, 00:05",
		);
	});

	it("keeps a date that is not a timestamp as it is", () => {
		expect(formatBuildDate("unknown", "UTC")).toBe("unknown");
	});
});

describe("isBuildInfo", () => {
	it("accepts a short or full hash and an ISO commit time", () => {
		expect(
			isBuildInfo({ commit: "1d12f39", date: "2026-10-24T13:29:07+02:00" }),
		).toBe(true);
		expect(
			isBuildInfo({ commit: "a".repeat(40), date: "2026-10-24T11:29:07Z" }),
		).toBe(true);
		expect(isBuildInfo({ commit: "unknown", date: "unknown" })).toBe(true);
	});

	it("refuses other text", () => {
		expect(
			isBuildInfo({ commit: "<b>x</b>", date: "2026-10-24T11:29:07Z" }),
		).toBe(false);
		expect(isBuildInfo({ commit: "1d12f39", date: "tomorrow" })).toBe(false);
		expect(isBuildInfo({ commit: "1d12f39" })).toBe(false);
		expect(isBuildInfo("1d12f39")).toBe(false);
	});
});
