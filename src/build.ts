import { isObject } from "./protocol";

/**
 * The commit that this page was built from. vite.config.ts reads it from git at build time; "unknown" stands for a
 * build without git. Pages report it to the host, so the host sees who runs an older version.
 */
export interface BuildInfo {
	/** The abbreviated or full commit hash. */
	readonly commit: string;
	/** The commit time in ISO 8601 with its offset, for example "2026-10-24T13:29:07+02:00". */
	readonly date: string;
}

const COMMIT_PATTERN = /^(?:[0-9a-f]{4,40}|unknown)$/;
const DATE_PATTERN =
	/^(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})|unknown)$/;

/** Git commit dates are the only release ordering, independent of the browser clock. */
export function isBuildDate(value: unknown): value is string {
	return (
		typeof value === "string" &&
		DATE_PATTERN.test(value) &&
		Number.isFinite(Date.parse(value))
	);
}

export function newerBuildDate(local: string, remote: string): boolean {
	return (
		isBuildDate(local) &&
		isBuildDate(remote) &&
		Date.parse(remote) > Date.parse(local)
	);
}

export const UPDATE_DATE_PARAM = "update_to";

/** Retry once per advertised date; preserve the room key in the fragment. */
export function updateUrl(
	pageUrl: string,
	local: string,
	remote: string,
): string | undefined {
	if (!newerBuildDate(local, remote)) return undefined;
	const url = new URL(pageUrl);
	const attempted = url.searchParams.get(UPDATE_DATE_PARAM);
	if (
		attempted &&
		isBuildDate(attempted) &&
		Date.parse(attempted) >= Date.parse(remote)
	)
		return undefined;
	url.searchParams.set(UPDATE_DATE_PARAM, remote);
	return url.toString();
}

export function isBuildInfo(value: unknown): value is BuildInfo {
	return (
		isObject(value) &&
		typeof value.commit === "string" &&
		COMMIT_PATTERN.test(value.commit) &&
		typeof value.date === "string" &&
		DATE_PATTERN.test(value.date)
	);
}

/**
 * The commit time as "Oct 24,'26, 13:49" in `timeZone`, the viewer's own zone when undefined. Text that is not a
 * timestamp stays as it is.
 */
export function formatBuildDate(date: string, timeZone?: string): string {
	const time = Date.parse(date);
	if (Number.isNaN(time)) return date;
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		month: "short",
		day: "numeric",
		year: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(time);
	const part = (type: Intl.DateTimeFormatPartTypes): string =>
		parts.find((item) => item.type === type)?.value ?? "";
	return `${part("month")} ${part("day")},'${part("year")}, ${part("hour")}:${part("minute")}`;
}
