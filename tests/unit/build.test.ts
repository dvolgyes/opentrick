import { describe, expect, it } from "vitest";
import { formatBuildDate, isBuildInfo } from "../../src/build";

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
