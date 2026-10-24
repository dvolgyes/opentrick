import { expect, type Page, test } from "@playwright/test";
import {
	type CallProbe,
	caption,
	counts,
	installCallProbe,
	joinWith,
	leaveButton,
} from "./call-probe";
import { Player, reportNetwork } from "./player";
import {
	CONNECT_MS,
	expectSeat,
	hostRows,
	pick,
	type SeatKey,
	seatLabel,
} from "./room";

/**
 * The host's page reloads while one player sends video to another. Call signaling goes directly between the two
 * seats, and each seat pair has its own media connection, so the stream does not go through the host and must
 * not stop. North hosts and is in the call with audio only; South sends its camera; East sees cameras; West only
 * plays.
 */
test.describe.configure({ mode: "serial" });

const players = {} as Record<SeatKey, Player>;

/** East's video frames from South in samples 500 ms apart, and the id of the track that shows them. */
function southFrames(
	page: Page,
	samples: number,
): Promise<{ track: string | null; frames: number[] }> {
	return page.evaluate(async (count) => {
		const probe = (window as unknown as { __callProbe: CallProbe }).__callProbe;
		const trackOfSouth = (): string | null => {
			const node = document.querySelector('[data-testid="video-S"]');
			const source = node instanceof HTMLVideoElement ? node.srcObject : null;
			return source instanceof MediaStream
				? (source.getVideoTracks()[0]?.id ?? null)
				: null;
		};
		const frames = async (track: string | null): Promise<number> => {
			let total = 0;
			for (const peer of probe.peers) {
				if (peer.connectionState === "closed") continue;
				(await peer.getStats()).forEach(
					(entry: {
						type: string;
						trackIdentifier?: string;
						framesReceived?: number;
					}) => {
						if (entry.type === "inbound-rtp" && entry.trackIdentifier === track)
							total += entry.framesReceived ?? 0;
					},
				);
			}
			return total;
		};
		const track = trackOfSouth();
		const result: number[] = [];
		for (let index = 0; index < count; index++) {
			result.push(await frames(track));
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		return { track, frames: result };
	}, samples);
}

test.beforeAll(async ({ browser, baseURL }) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	for (const seat of ["N", "E", "S", "W"] as const) {
		players[seat] = await Player.open(browser, baseURL, `host-reload-${seat}`, {
			permissions: seat === "S" ? ["microphone", "camera"] : ["microphone"],
		});
		await players[seat].addInitScript(installCallProbe);
	}
});

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires an object pattern as the first parameter.
test.afterEach(async ({}, testInfo) => {
	if (testInfo.status !== testInfo.expectedStatus)
		await reportNetwork(Object.values(players));
});

test.afterAll(async () => {
	for (const player of Object.values(players)) await player.close();
});

test("South's video reaches East without a gap while the host North reloads", async () => {
	test.setTimeout(180_000);
	const north = await players.N.page("./?host=north");
	await north
		.getByTestId("create")
		.evaluate((button) => (button as HTMLButtonElement).click());
	await expectSeat(north, "N");
	const linkUrl = new URL(north.url());
	linkUrl.searchParams.delete("selected_player");
	const link = linkUrl.toString();
	const tab = { N: north } as Record<SeatKey, Page>;
	for (const seat of ["E", "S", "W"] as const) {
		tab[seat] = await players[seat].page(link);
		await pick(tab[seat], seat);
	}
	for (const seat of ["N", "E", "S", "W"] as const)
		await expect(tab[seat].getByTestId("table")).toHaveAttribute(
			"data-phase",
			"auction",
			{ timeout: CONNECT_MS },
		);
	await expect(hostRows(tab.E)).toHaveAttribute("data-seat", "N", {
		timeout: CONNECT_MS,
	});

	await joinWith(tab.N, "Audio only");
	await joinWith(tab.S, "Send camera; hear others");
	await joinWith(tab.E, "See cameras; send voice");
	await expect(tab.E.getByTestId("tile-S")).toHaveAttribute(
		"data-video",
		"on",
		{
			timeout: CONNECT_MS,
		},
	);
	await expect(tab.E.getByTestId("video-S")).toHaveAttribute(
		"data-play",
		"playing",
	);
	await expect(caption(tab.E, "N")).toHaveText(
		`${seatLabel("N")} · Audio only`,
		{ timeout: CONNECT_MS },
	);

	const peersBefore = (await counts(tab.E)).peers;
	// 16 samples, 8 s: North's page is away for part of this time, then hosts again.
	const [during] = await Promise.all([
		southFrames(tab.E, 16),
		tab.N.waitForTimeout(500).then(() => tab.N.reload()),
	]);
	expect(during.track).not.toBeNull();
	for (const [index, count] of during.frames.entries()) {
		if (index === 0) continue;
		expect(
			count,
			`frames at sample ${index}: ${during.frames.join(", ")}`,
		).toBeGreaterThan(during.frames[index - 1] ?? 0);
	}

	// North hosts again and comes back in the call with its audio; the stream from South is the same track.
	await expectSeat(tab.N, "N", { timeout: CONNECT_MS });
	await expect(hostRows(tab.E)).toHaveAttribute("data-seat", "N", {
		timeout: CONNECT_MS,
	});
	await expect(leaveButton(tab.N)).toBeVisible({ timeout: CONNECT_MS });
	await expect(caption(tab.E, "N")).toHaveText(
		`${seatLabel("N")} · Audio only`,
		{ timeout: CONNECT_MS },
	);
	// East built a new media connection to the reloaded North; the one to South stayed.
	expect((await counts(tab.E)).peers).toBeGreaterThan(peersBefore);
	const after = await southFrames(tab.E, 3);
	expect(after.track).toBe(during.track);
	expect(after.frames[2]).toBeGreaterThan(after.frames[0] ?? 0);
	await expect(tab.E.getByTestId("tile-S")).toHaveAttribute("data-video", "on");
});

test("no uncaught errors", () => {
	expect(Object.values(players).flatMap((player) => player.errors)).toEqual([]);
});
