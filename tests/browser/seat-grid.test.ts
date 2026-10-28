import "../../src/ui/style.css";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { SEATS, type Seat } from "../../src/protocol";
import { seatGrid } from "../../src/ui/seat-grid";

afterEach(async () => {
	document.body.replaceChildren();
	await page.viewport(414, 896);
});

/** The seat at each side of a rendered grid, from the card centres. */
function sides(
	bottom: Seat | undefined,
	center?: HTMLElement,
): Record<"top" | "left" | "right" | "bottom", Seat> {
	const grid = seatGrid(
		SEATS.map((seat) => ({
			seat,
			element: Object.assign(document.createElement("section"), {
				textContent: seat,
			}),
		})),
		{ center, bottom },
	);
	document.body.replaceChildren(grid);
	const boxes = SEATS.map((seat) => {
		const box = grid
			.querySelector(`[data-seat="${seat}"]`)
			?.getBoundingClientRect();
		if (!box) throw new Error(`no card for ${seat}`);
		return {
			seat,
			x: box.x + box.width / 2,
			y: box.y + box.height / 2,
		};
	});
	const pick = (
		compare: (a: (typeof boxes)[number], b: (typeof boxes)[number]) => number,
	): Seat => {
		const [first] = boxes.toSorted(compare);
		if (!first) throw new Error("no cards");
		return first.seat;
	};
	return {
		top: pick((a, b) => a.y - b.y),
		bottom: pick((a, b) => b.y - a.y),
		left: pick((a, b) => a.x - b.x),
		right: pick((a, b) => b.x - a.x),
	};
}

for (const [width, height] of [
	[1280, 800],
	[390, 844],
] as const) {
	it(`without a seated viewer, South is at the bottom and West on the left (${width}px)`, async () => {
		await page.viewport(width, height);
		expect(sides(undefined)).toEqual({
			top: "N",
			left: "W",
			right: "E",
			bottom: "S",
		});
		expect(sides(undefined, document.createElement("div"))).toEqual({
			top: "N",
			left: "W",
			right: "E",
			bottom: "S",
		});
	});

	it(`the viewer sits at the bottom and the next seats clockwise sit left, top and right (${width}px)`, async () => {
		await page.viewport(width, height);
		expect(sides("W")).toEqual({
			bottom: "W",
			left: "N",
			top: "E",
			right: "S",
		});
		expect(sides("N", document.createElement("div"))).toEqual({
			bottom: "N",
			left: "E",
			top: "S",
			right: "W",
		});
		expect(sides("E")).toEqual({
			bottom: "E",
			left: "S",
			top: "W",
			right: "N",
		});
	});
}
