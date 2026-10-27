import { expect, type Page, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { Player, reportNetwork } from "./player";
import { CONNECT_MS, createRoom, expectSeat, pick, type SeatKey } from "./room";

const SEATS = ["N", "E", "S", "W"] as const;

/** Delay only this page's outgoing pings; its echoes and reports still travel at once. */
function delayPings(): void {
	const probe = { sent: 0, dropped: 0, drop: false };
	Object.defineProperty(window, "__qualityProbe", { value: probe });
	const decoder = new TextDecoder();
	const send = RTCDataChannel.prototype.send as (
		this: RTCDataChannel,
		data: unknown,
	) => void;
	(RTCDataChannel.prototype as { send: (data: unknown) => void }).send =
		function (this: RTCDataChannel, data: unknown) {
			const bytes =
				data instanceof ArrayBuffer
					? new Uint8Array(data)
					: ArrayBuffer.isView(data)
						? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
						: undefined;
			// Trystero 0.26: room frame, then a version-2 inline JSON action with a 36-byte header.
			const start =
				bytes && bytes[0] === 1
					? 3 + (((bytes[1] ?? 0) << 8) | (bytes[2] ?? 0))
					: -1;
			if (
				bytes &&
				start >= 0 &&
				bytes.length >= start + 36 &&
				bytes[start] === 2 &&
				bytes[start + 1] === 16 &&
				decoder
					.decode(bytes.subarray(start + 2, start + 34))
					.replaceAll("\0", "") === "opentrick-ctl"
			) {
				const metadata =
					((bytes[start + 34] ?? 0) << 8) | (bytes[start + 35] ?? 0);
				const message = JSON.parse(
					decoder.decode(bytes.subarray(start + 36 + metadata)),
				) as { k?: string };
				if (message.k === "ping") {
					probe.sent++;
					if (probe.drop) {
						probe.dropped++;
						return;
					}
					setTimeout(() => {
						if (this.readyState === "open") send.call(this, data);
					}, 900);
					return;
				}
			}
			send.call(this, data);
		};
}

const trip = (page: Page, seat: SeatKey) =>
	page.getByTestId(`round-trip-${seat}`);
const cell = (page: Page, from: SeatKey, to: SeatKey) =>
	page.getByTestId(`quality-${from}-${to}`);

test("four pages measure their own direct peers and the host collects directed rows through loss and reload", async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(240_000);
	if (!baseURL) throw new Error("missing baseURL");
	const players = {} as Record<SeatKey, Player>;
	const pages = {} as Record<SeatKey, Page>;
	try {
		for (const seat of SEATS)
			players[seat] = await Player.open(browser, baseURL, seat);
		await players.E.addInitScript(delayPings);
		pages.W = await players.W.page("/");
		const link = await createRoom(pages.W);
		for (const seat of ["N", "S", "E"] as const) {
			pages[seat] = await players[seat].page(link);
			await pick(pages[seat], seat);
		}
		for (const from of SEATS) {
			await expect(trip(pages[from], from)).toBeHidden();
			for (const to of SEATS.filter((seat) => seat !== from))
				await expect(trip(pages[from], to)).toHaveAttribute(
					"title",
					/Roundtrip: \d+\.\d\dsec$/,
					{ timeout: CONNECT_MS },
				);
		}
		await pages.W.getByTestId("host-controls").click();
		await expect(
			pages.W.getByTestId("quality-matrix").locator('th[scope="col"]'),
		).toHaveText([...SEATS]);
		await expect(
			pages.W.getByTestId("quality-matrix").locator('th[scope="row"]'),
		).toHaveText([...SEATS]);
		await expect(
			pages.W.getByTestId("quality-matrix").locator("td[data-quality]"),
		).toHaveCount(12);
		for (const seat of SEATS)
			await expect(cell(pages.W, seat, seat)).toBeEmpty();
		// East's delayed pings affect its entire row, including guest-to-guest measurements, but not the reverse direction.
		for (const to of ["N", "S", "W"] as const) {
			await expect(trip(pages.E, to)).toHaveAttribute("data-quality", "poor");
			await expect(cell(pages.W, "E", to)).toHaveAttribute(
				"data-quality",
				"poor",
			);
			await expect(cell(pages.W, to, "E")).toHaveAttribute(
				"data-quality",
				/^(excellent|good|average)$/,
			);
		}
		await pages.E.evaluate(() => {
			(
				window as unknown as { __qualityProbe: { drop: boolean } }
			).__qualityProbe.drop = true;
		});
		await expect(cell(pages.W, "E", "N")).toHaveAttribute(
			"data-quality",
			"breaking-up",
			{ timeout: 25_000 },
		);
		await expect(cell(pages.W, "E", "N")).toHaveText(">5.00");
		await expect(cell(pages.W, "N", "E")).toHaveAttribute(
			"data-quality",
			/^(excellent|good|average)$/,
		);
		await expect
			.poll(() =>
				pages.E.evaluate(
					() =>
						(window as unknown as { __qualityProbe: { dropped: number } })
							.__qualityProbe.dropped,
				),
			)
			.toBeGreaterThan(0);
		await pages.E.reload();
		await expectSeat(pages.E, "E", { timeout: CONNECT_MS });
		await expect(cell(pages.W, "E", "N")).toHaveAttribute(
			"data-quality",
			"poor",
			{ timeout: CONNECT_MS },
		);
		await expect(trip(pages.E, "N")).toHaveAttribute("data-quality", "poor");
		await expect(
			pages.W.getByTestId("quality-matrix").locator("td[data-quality]"),
		).toHaveCount(12);
		for (const player of Object.values(players))
			expect(player.errors).toEqual([]);
	} catch (error) {
		await reportNetwork(Object.values(players));
		throw error;
	} finally {
		for (const player of Object.values(players)) await player.close();
	}
});

test("one human and three local bots have no network indicators or matrix measurements, including after reload", async ({
	page,
}) => {
	await mockBotBidding(page, () => "P");
	await page.goto("/");
	await createRoom(page, ["N", "E", "S"]);
	for (const reload of [false, true]) {
		if (reload) await page.reload();
		await expectSeat(page, "W", { timeout: CONNECT_MS });
		for (const seat of SEATS) await expect(trip(page, seat)).toBeHidden();
		await page.getByTestId("host-controls").click();
		const matrix = page.getByTestId("quality-matrix");
		await expect(matrix.locator('th[scope="row"] s')).toHaveText([
			"N",
			"E",
			"S",
		]);
		await expect(matrix.locator('th[scope="col"] s')).toHaveText([
			"N",
			"E",
			"S",
		]);
		await expect(matrix.locator("td[data-quality]")).toHaveCount(0);
		await expect(matrix.locator("td")).toHaveText(Array<string>(16).fill(""));
		await page
			.getByTestId("host-controls-dialog")
			.getByRole("button", { name: "Close", exact: true })
			.click();
	}
});
