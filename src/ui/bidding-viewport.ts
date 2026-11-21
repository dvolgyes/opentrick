/** Keeps the bottom of the phone bidding board in the visible viewport as its layout changes. */
export function watchBiddingViewport(
	room: HTMLElement,
	table: HTMLElement,
): {
	update(): void;
	dispose(): void;
} {
	const document = table.ownerDocument;
	const window = document.defaultView;
	const board = table.querySelector<HTMLElement>(".mobile-auction-board");
	if (!window || !board) throw new Error("phone bidding board has no window");
	let frame: number | undefined;
	let bidPointer: number | undefined;
	let deferred = false;
	const update = (): void => {
		if (frame !== undefined) return;
		frame = window.requestAnimationFrame(() => {
			frame = undefined;
			if (
				!board.isConnected ||
				room.dataset.form !== "compact" ||
				table.dataset.phase !== "auction" ||
				document.querySelector("dialog[open]")
			)
				return;
			if (bidPointer !== undefined) {
				deferred = true;
				return;
			}
			deferred = false;
			const viewport = window.visualViewport;
			const top = viewport?.offsetTop ?? 0;
			const bottom = top + (viewport?.height ?? window.innerHeight);
			const edge = board.getBoundingClientRect().bottom;
			if (edge > bottom + 1) window.scrollBy(0, edge - bottom);
			else if (edge < top) window.scrollBy(0, edge - top);
		});
	};
	const startBidTouch = (event: PointerEvent): void => {
		if (
			event.pointerType === "touch" &&
			event.isPrimary &&
			event.target instanceof Element &&
			event.target.closest(".bid-box button:enabled")
		)
			bidPointer = event.pointerId;
	};
	const endBidTouch = (event: PointerEvent): void => {
		if (event.pointerId !== bidPointer) return;
		bidPointer = undefined;
		if (deferred) update();
	};
	board.addEventListener("pointerdown", startBidTouch, true);
	document.addEventListener("pointerup", endBidTouch, true);
	document.addEventListener("pointercancel", endBidTouch, true);
	const observer = new ResizeObserver(update);
	observer.observe(table);
	observer.observe(board);
	window.addEventListener("resize", update);
	window.visualViewport?.addEventListener("resize", update);
	document.addEventListener("close", update, true);
	update();
	return {
		update,
		dispose() {
			if (frame !== undefined) window.cancelAnimationFrame(frame);
			observer.disconnect();
			board.removeEventListener("pointerdown", startBidTouch, true);
			document.removeEventListener("pointerup", endBidTouch, true);
			document.removeEventListener("pointercancel", endBidTouch, true);
			window.removeEventListener("resize", update);
			window.visualViewport?.removeEventListener("resize", update);
			document.removeEventListener("close", update, true);
		},
	};
}
