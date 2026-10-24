import type { BuildInfo } from "../build";
import type { PlayerReport } from "../p2p/host-engine";
import { type JsonObject, SEATS, type Seat } from "../protocol";

export interface DebugInput {
	/** `Date.now()` of the export. */
	readonly exportedAt: number;
	readonly build: BuildInfo;
	/** From `pageAddress`, so that the table key stays out. */
	readonly page: string;
	readonly hostSeat: Seat;
	/** The host's own `pageReport`. */
	readonly host: JsonObject;
	readonly bots: readonly Seat[];
	readonly reports: readonly PlayerReport[];
	/** How many players' pages the host asked for a new report. */
	readonly asked: number;
	/** The table view and the log, copied as they are; neither holds a key or a client id. */
	readonly view: object;
	readonly entries: readonly object[];
}

/** The page's address without its query and fragment; the fragment holds the table key. */
export function pageAddress(href: string): string {
	const url = new URL(href);
	return `${url.origin}${url.pathname}`;
}

function seatSource(input: DebugInput, seat: Seat): JsonObject {
	if (seat === input.hostSeat)
		return { seat, source: "host", build: input.build, detail: input.host };
	const report = input.reports.find((item) => item.seat === seat);
	if (report)
		return {
			seat,
			source: "player",
			build: report.build,
			receivedAt: new Date(report.receivedAt).toISOString(),
			detail: report.detail,
		};
	return { seat, source: input.bots.includes(seat) ? "bot" : "missing" };
}

/** The JSON that the host's Debug button copies: the table, its log, and every seat's page. */
export function debugExport(input: DebugInput): JsonObject {
	return {
		kind: "opentrick-debug-export",
		version: 1,
		exportedAt: new Date(input.exportedAt).toISOString(),
		build: input.build,
		page: input.page,
		asked: input.asked,
		seats: SEATS.map((seat) => seatSource(input, seat)),
		view: input.view,
		entries: input.entries,
	};
}
