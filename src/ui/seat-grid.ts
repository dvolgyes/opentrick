import { SEATS, type Seat } from "../protocol";
import { el } from "./dom";

type Position = "bottom" | "left" | "top" | "right";
/** Reading order of the places: the top card first and the viewer's card last. */
const READING_ORDER: readonly Position[] = ["top", "left", "right", "bottom"];

/**
 * The viewer's seat is at the bottom, and the next seats in clockwise order sit at the left, the top and the right:
 * South at the bottom puts West left, North on top and East right. A grid without a seated viewer puts South at the
 * bottom.
 */
export function seatGrid(
	cards: readonly { readonly seat: Seat; readonly element: HTMLElement }[],
	options: { readonly center?: HTMLElement; readonly bottom?: Seat } = {},
): HTMLElement {
	const { center, bottom = "S" } = options;
	/** Clockwise steps from the viewer: the next seat sits left, the partner on top, the last seat right. */
	const position = (seat: Seat): Position => {
		const step = (SEATS.indexOf(seat) - SEATS.indexOf(bottom) + 4) % 4;
		return step === 0
			? "bottom"
			: step === 1
				? "left"
				: step === 2
					? "top"
					: "right";
	};
	return el(
		"div",
		{
			className: center ? "seat-grid with-center" : "seat-grid",
			attrs: { "data-testid": "seat-grid" },
		},
		...cards
			.toSorted(
				(a, b) =>
					READING_ORDER.indexOf(position(a.seat)) -
					READING_ORDER.indexOf(position(b.seat)),
			)
			.map((card) => {
				card.element.dataset.seat = card.seat;
				card.element.dataset.position = position(card.seat);
				card.element.classList.add("seat-card");
				return card.element;
			}),
		...(center ? [el("div", { className: "seat-center" }, center)] : []),
	);
}
