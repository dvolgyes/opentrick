import { afterEach, describe, expect, it } from "vitest";
import { englishTranslator } from "../../src/i18n";
import { qualityMatrix } from "../../src/ui/quality-matrix";
import "../../src/ui/style.css";

afterEach(() => document.body.replaceChildren());

describe("quality matrix", () => {
	it("labels directed NESW axes, keeps self cells empty, and combines quality colors with numeric hints", () => {
		const matrix = qualityMatrix(englishTranslator);
		document.body.append(matrix.element);
		matrix.update(
			[
				{ seat: "N", seats: [{ seat: "E", ms: 40 }] },
				{ seat: "E", seats: [{ seat: "N", ms: 900 }] },
			],
			new Set(),
		);
		expect(
			[...matrix.element.querySelectorAll('th[scope="col"]')].map(
				(cell) => cell.textContent,
			),
		).toEqual(["N", "E", "S", "W"]);
		expect(
			[...matrix.element.querySelectorAll('th[scope="row"]')].map(
				(cell) => cell.textContent,
			),
		).toEqual(["N", "E", "S", "W"]);
		const cell = (from: string, to: string) =>
			matrix.element.querySelector<HTMLElement>(
				`[data-testid="quality-${from}-${to}"]`,
			) as HTMLElement;
		expect(cell("N", "E").textContent).toBe("0.04");
		expect(cell("N", "E").title).toBe("Network: excellent\nRoundtrip: 0.04sec");
		expect(cell("E", "N").title).toBe("Network: poor\nRoundtrip: 0.90sec");
		// The whole cell takes the quality color, not only an underline.
		expect(getComputedStyle(cell("N", "E")).backgroundColor).toBe(
			"rgb(46, 204, 64)",
		);
		expect(getComputedStyle(cell("E", "N")).backgroundColor).toBe(
			"rgb(255, 152, 0)",
		);
		expect(getComputedStyle(cell("N", "E")).borderBottomStyle).toBe("none");
		for (const seat of ["N", "E", "S", "W"]) {
			expect(cell(seat, seat).textContent).toBe("");
			expect(cell(seat, seat).hasAttribute("data-quality")).toBe(false);
			expect(getComputedStyle(cell(seat, seat)).backgroundColor).toBe(
				"rgba(0, 0, 0, 0)",
			);
		}
		expect(cell("S", "W").textContent).toBe("…");
		expect(cell("S", "W").title).toBe("No measurement");
	});

	it("removes bot rows and columns even with old samples, and clears removed results", () => {
		const matrix = qualityMatrix(englishTranslator);
		document.body.append(matrix.element);
		const rows = [
			{
				seat: "N" as const,
				seats: [{ seat: "E" as const, ms: 5000, lower: true as const }],
			},
		];
		matrix.update(rows, new Set());
		const cell = matrix.element.querySelector<HTMLElement>(
			'[data-testid="quality-N-E"]',
		) as HTMLElement;
		expect(cell.textContent).toBe(">5.00");
		expect(cell.dataset.quality).toBe("breaking-up");
		matrix.update(rows, new Set(["E"]));
		expect(
			[...matrix.element.querySelectorAll("s")].map((node) => node.textContent),
		).toEqual(["E", "E"]);
		expect(cell.textContent).toBe("");
		expect(cell.hasAttribute("data-quality")).toBe(false);
		matrix.update([], new Set());
		expect(cell.textContent).toBe("…");
		expect(cell.title).toBe("No measurement");
	});
});
