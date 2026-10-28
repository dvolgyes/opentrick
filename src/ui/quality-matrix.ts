import type { Translate } from "../i18n";
import type { QualityRow } from "../p2p/peer-quality";
import { SEATS, type Seat } from "../protocol";
import { el } from "./dom";
import { qualityView } from "./table-model";

/**
 * Rows are the senders: each page pings the others and measures the round trip. Columns are the responders.
 * Color is accompanied by a numeric value and hint.
 */
export function qualityMatrix(t: Translate) {
	const table = el("table", {
		className: "quality-matrix",
		attrs: { "data-testid": "quality-matrix" },
	});
	const caption = el(
		"caption",
		{},
		t("Roundtrip times [s] (Row sender, column responder)"),
	);
	const headings = [
		el("th", {}, ""),
		...SEATS.map((seat) => el("th", { attrs: { scope: "col" } }, seat)),
	];
	const rows = SEATS.map((from) => ({
		from,
		heading: el("th", { attrs: { scope: "row" } }, from),
		cells: SEATS.map((to) => ({
			to,
			node: el("td", { attrs: { "data-testid": `quality-${from}-${to}` } }),
		})),
	}));
	table.append(
		caption,
		el("thead", {}, el("tr", {}, ...headings)),
		el(
			"tbody",
			{},
			...rows.map((row) =>
				el("tr", {}, row.heading, ...row.cells.map((cell) => cell.node)),
			),
		),
	);
	return {
		element: table,
		update(matrix: readonly QualityRow[], bots: ReadonlySet<Seat>): void {
			const label = (node: HTMLElement, seat: Seat) =>
				node.replaceChildren(bots.has(seat) ? el("s", {}, seat) : seat);
			for (const [index, row] of rows.entries()) {
				label(row.heading, row.from);
				const column = headings[index + 1];
				if (column) label(column, row.from);
				for (const { to, node } of row.cells) {
					const sample = matrix
						.find((entry) => entry.seat === row.from)
						?.seats.find((entry) => entry.seat === to);
					const applicable =
						row.from !== to && !bots.has(row.from) && !bots.has(to);
					const quality =
						applicable && sample ? qualityView(sample, t) : undefined;
					node.textContent = quality
						? `${sample?.lower ? ">" : ""}${(Math.round((sample?.ms ?? 0) / 10) / 100).toFixed(2)}`
						: applicable
							? "…"
							: "";
					node.title = quality
						? `${quality.text}\n${quality.title}`
						: applicable
							? t("No measurement")
							: "";
					if (quality) node.dataset.quality = quality.quality;
					else delete node.dataset.quality;
				}
			}
		},
	};
}
