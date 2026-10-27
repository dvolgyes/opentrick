import type { Seat } from "../protocol";
import { el } from "./dom";

/** Spatial compass order is independent of the game's clockwise seat order. */
export function seatGrid(
	cards: readonly { readonly seat: Seat; readonly element: HTMLElement }[],
	center?: HTMLElement,
): HTMLElement {
	const order: readonly Seat[] = ["N", "W", "E", "S"];
	return el(
		"div",
		{
			className: center ? "seat-grid with-center" : "seat-grid",
			attrs: { "data-testid": "seat-grid" },
		},
		...order
			.flatMap((seat) => cards.filter((card) => card.seat === seat))
			.map((card) => {
				card.element.dataset.seat = card.seat;
				card.element.classList.add("seat-card");
				return card.element;
			}),
		...(center ? [el("div", { className: "seat-center" }, center)] : []),
	);
}
