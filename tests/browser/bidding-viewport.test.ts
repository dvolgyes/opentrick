import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { watchBiddingViewport } from "../../src/ui/bidding-viewport";

afterEach(async () => {
	document.body.replaceChildren();
	window.scrollTo(0, 0);
	await page.viewport(414, 896);
});

/** Wait for layout observation and the requested animation frame. */
async function settle(): Promise<void> {
	for (let index = 0; index < 3; index++)
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => resolve()),
		);
}

function fixture(): {
	room: HTMLElement;
	table: HTMLElement;
	board: HTMLElement;
	above: HTMLElement;
} {
	const room = document.createElement("section");
	room.dataset.form = "compact";
	const table = document.createElement("div");
	table.dataset.phase = "auction";
	const above = document.createElement("div");
	above.style.height = "280px";
	const board = document.createElement("div");
	board.className = "mobile-auction-board";
	board.style.height = "400px";
	const below = document.createElement("div");
	below.style.height = "600px";
	table.append(above, board, below);
	room.append(table);
	document.body.replaceChildren(room);
	return { room, table, board, above };
}

it("keeps the bidding board bottom visible after content and viewport changes", async () => {
	await page.viewport(390, 400);
	const { room, table, board, above } = fixture();
	const watcher = watchBiddingViewport(room, table);
	try {
		await settle();
		expect(board.getBoundingClientRect().bottom).toBeLessThanOrEqual(
			window.innerHeight + 1,
		);
		above.style.height = "450px";
		await settle();
		expect(board.getBoundingClientRect().bottom).toBeLessThanOrEqual(
			window.innerHeight + 1,
		);
		await page.viewport(390, 300);
		await settle();
		expect(board.getBoundingClientRect().bottom).toBeLessThanOrEqual(
			window.innerHeight + 1,
		);
	} finally {
		watcher.dispose();
	}
});

it("leaves dialogs and non-bidding screens alone and stops after disposal", async () => {
	await page.viewport(390, 400);
	const { room, table, board, above } = fixture();
	const dialog = document.createElement("dialog");
	document.body.append(dialog);
	dialog.showModal();
	window.scrollTo(0, 0);
	const watcher = watchBiddingViewport(room, table);
	try {
		await settle();
		expect(window.scrollY).toBe(0);
		dialog.close();
		await settle();
		expect(board.getBoundingClientRect().bottom).toBeLessThanOrEqual(
			window.innerHeight + 1,
		);
		table.dataset.phase = "play";
		window.scrollTo(0, 0);
		above.style.height = "420px";
		await settle();
		expect(window.scrollY).toBe(0);
		table.dataset.phase = "auction";
		room.dataset.form = "desktop";
		watcher.update();
		await settle();
		expect(window.scrollY).toBe(0);
		watcher.dispose();
		room.dataset.form = "compact";
		above.style.height = "500px";
		await settle();
		expect(window.scrollY).toBe(0);
	} finally {
		watcher.dispose();
	}
});
