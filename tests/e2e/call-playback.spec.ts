import { expect, type Page, test } from "@playwright/test";
import {
	installCallProbe,
	joinWith,
	peerAudioGrowth,
	SOUND,
	toggle,
} from "./call-probe";
import { buildRelayHubs, Player } from "./player";
import { CONNECT_MS, createRoom, pick, type SeatKey } from "./room";

const SEATS = ["W", "N", "E", "S"] as const;
const tab = {} as Record<SeatKey, Page>;
const players: Player[] = [];

test.beforeEach(async ({ browser, baseURL }) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const rig = { relayHubs: buildRelayHubs() };
	let link = "./";
	for (const seat of SEATS) {
		const player = await Player.open(
			browser,
			baseURL,
			`playback-${seat}`,
			{
				permissions: ["microphone"],
				...(seat === "S"
					? {
							viewport: { width: 390, height: 664 },
							isMobile: true,
							hasTouch: true,
						}
					: { viewport: { width: 1440, height: 900 } }),
			},
			rig,
		);
		players.push(player);
		await player.addInitScript(installCallProbe);
		const page = await player.page(link);
		tab[seat] = page;
		if (seat === "W") link = await createRoom(page);
		else await pick(page, seat);
	}
	for (const page of Object.values(tab)) await joinWith(page, "Audio only");
	await Promise.all(
		SEATS.map(async (seat) => {
			const page = tab[seat];
			await expect
				.poll(
					async () =>
						(await peerAudioGrowth(page)).filter((bytes) => bytes > SOUND)
							.length,
					{
						timeout: CONNECT_MS,
					},
				)
				.toBe(3);
			for (const remote of SEATS) {
				if (remote === seat) continue;
				const audio = page.getByTestId(`audio-${remote}`);
				await expect(audio).toHaveAttribute("data-play", "playing");
				expect(
					await audio.evaluate((node) => {
						const { srcObject } = node as HTMLAudioElement;
						return (
							srcObject instanceof MediaStream &&
							srcObject
								.getAudioTracks()
								.some((track) => track.readyState === "live")
						);
					}),
				).toBe(true);
			}
		}),
	);
});

test.afterEach(async () => {
	await Promise.all(players.splice(0).map((player) => player.close()));
});

test("playback policy: one phone tap unlocks every remote seat; late denial after Hear off is ignored", async () => {
	const phone = tab.S;
	const hear = toggle(phone, "Hear others: receive audio");
	const unlock = phone.getByRole("button", { name: "Tap to hear the call" });
	const seats = ["W", "N", "E"] as const;
	await expect(unlock).toBeHidden();
	await hear.click();
	await phone.evaluate(() => {
		const nativePlay = HTMLMediaElement.prototype.play;
		let activatingClick = false;
		let defer = false;
		const denials: (() => void)[] = [];
		const onClick = (event: MouseEvent): void => {
			if (
				!event.isTrusted ||
				!(event.target instanceof HTMLElement) ||
				!event.target.closest(".remote-audio-hear")
			)
				return;
			activatingClick = navigator.userActivation.isActive;
		};
		const endClick = (): void => {
			activatingClick = false;
		};
		document.addEventListener("click", onClick, true);
		document.addEventListener("click", endClick);
		HTMLMediaElement.prototype.play = function () {
			if (!this.matches(".remote-audio audio") || activatingClick) {
				return nativePlay.call(this);
			}
			const denied = new DOMException("Autoplay denied", "NotAllowedError");
			return defer
				? new Promise<void>((_, reject) => {
						denials.push(() => reject(denied));
					})
				: Promise.reject(denied);
		};
		document.addEventListener(
			"defer-audio-denial",
			() => {
				defer = true;
			},
			{ once: true },
		);
		document.addEventListener(
			"settle-audio-denials",
			() => {
				HTMLMediaElement.prototype.play = nativePlay;
				document.removeEventListener("click", onClick, true);
				document.removeEventListener("click", endClick);
				for (const deny of denials) deny();
				document.body.dataset.audioDenials = String(denials.length);
			},
			{ once: true },
		);
	});
	await hear.click();
	for (const seat of seats) {
		await expect(phone.getByTestId(`audio-${seat}`)).toHaveAttribute(
			"data-play",
			"blocked",
		);
	}
	await expect(unlock).toBeVisible();
	await unlock.tap();
	for (const seat of seats) {
		await expect(phone.getByTestId(`audio-${seat}`)).toHaveAttribute(
			"data-play",
			"playing",
		);
	}
	await expect(unlock).toBeHidden();

	await hear.click();
	await phone.evaluate(() =>
		document.dispatchEvent(new Event("defer-audio-denial")),
	);
	await hear.click();
	for (const seat of seats) {
		await expect(phone.getByTestId(`audio-${seat}`)).toHaveAttribute(
			"data-play",
			"starting",
		);
	}
	await hear.click();
	await phone.evaluate(() =>
		document.dispatchEvent(new Event("settle-audio-denials")),
	);
	await expect(phone.locator("body")).toHaveAttribute(
		"data-audio-denials",
		/^[1-9]\d*$/,
	);
	await expect(unlock).toBeHidden();
	for (const seat of seats) {
		await expect(phone.getByTestId(`audio-${seat}`)).toHaveAttribute(
			"data-play",
			"off",
		);
	}
	await hear.click();
});

test("playback policy: desktop offers recovery only for a policy denial", async () => {
	const desktop = tab.N;
	const hear = toggle(desktop, "Hear others: receive audio");
	const unlock = desktop.getByRole("button", { name: "Tap to hear the call" });
	await expect(unlock).toBeHidden();
	await hear.click();
	await desktop.evaluate(() => {
		const nativePlay = HTMLMediaElement.prototype.play;
		const deny = new Set(["E", "W"]);
		HTMLMediaElement.prototype.play = function () {
			if (this.matches(".remote-audio audio")) {
				const seat = this.dataset.seat;
				if (seat !== undefined && deny.delete(seat)) {
					const name = seat === "W" ? "NotAllowedError" : "NotSupportedError";
					return Promise.reject(new DOMException("Playback denied", name));
				}
			}
			return nativePlay.call(this);
		};
		document.addEventListener(
			"restore-native-play",
			() => {
				HTMLMediaElement.prototype.play = nativePlay;
			},
			{ once: true },
		);
	});
	await hear.click();
	const failed = desktop.getByTestId("audio-E");
	const blocked = desktop.getByTestId("audio-W");
	await expect(failed).toHaveAttribute("data-play", "failed");
	await expect(blocked).toHaveAttribute("data-play", "blocked");
	await expect(unlock).toBeVisible();
	await unlock.click();
	await expect(blocked).toHaveAttribute("data-play", "playing");
	await expect(failed).toHaveAttribute("data-play", "failed");
	await expect(unlock).toBeHidden();
	await desktop.evaluate(() =>
		document.dispatchEvent(new Event("restore-native-play")),
	);
	await hear.click();
	await hear.click();
});
