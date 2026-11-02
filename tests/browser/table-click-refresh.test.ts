import { afterEach, describe, expect, it } from "vitest";
import { cdp, page } from "vitest/browser";
import "../../src/ui/style.css";
import { playView, renderView } from "./table-mobile-play-fixtures";

afterEach(() => document.body.replaceChildren());

/** A real press and release at the same point, with a room update between them. */
async function pressThroughUpdate(target: HTMLElement, update: () => void) {
	target.scrollIntoView({ block: "nearest", inline: "nearest" });
	const frame = window.frameElement?.getBoundingClientRect();
	const box = target.getBoundingClientRect();
	const hit = document.elementFromPoint(
		box.left + box.width / 2,
		box.top + box.height / 2,
	);
	expect(hit === target || (hit !== null && target.contains(hit))).toBe(true);
	const x = (frame?.left ?? 0) + box.left + box.width / 2;
	const y = (frame?.top ?? 0) + box.top + box.height / 2;
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		if (type === "mouseReleased") update();
		await cdp().send("Input.dispatchMouseEvent", {
			type,
			x,
			y,
			button: "left",
			buttons: type === "mousePressed" ? 1 : 0,
			clickCount: 1,
		});
	}
}

/** Touch input follows the same real browser path as a tap on a phone. */
async function tapThroughUpdate(target: HTMLElement, update: () => void) {
	target.scrollIntoView({ block: "nearest", inline: "nearest" });
	const frame = window.frameElement?.getBoundingClientRect();
	const box = target.getBoundingClientRect();
	const hit = document.elementFromPoint(
		box.left + box.width / 2,
		box.top + box.height / 2,
	);
	expect(hit === target || (hit !== null && target.contains(hit))).toBe(true);
	await cdp().send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [
			{
				x: (frame?.left ?? 0) + box.left + box.width / 2,
				y: (frame?.top ?? 0) + box.top + box.height / 2,
				id: 0,
			},
		],
	});
	update();
	await cdp().send("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	});
}

function required(selector: string): HTMLElement {
	const node = document.querySelector<HTMLElement>(selector);
	if (!node) throw new Error(`Missing ${selector}`);
	return node;
}

function playButton(label: string): HTMLElement {
	const node = [
		...document.querySelectorAll<HTMLElement>(".play-controls button"),
	].find((button) => button.textContent === label);
	if (!node) throw new Error(`Missing ${label}`);
	return node;
}

async function viewport(form: "desktop" | "compact") {
	if (form === "compact") await page.viewport(414, 896);
	else await page.viewport(1280, 900);
}

const display = {
	available: true as const,
	view: {
		status: "subscribed" as const,
		canJoin: true,
		form: "desktop" as const,
		media: {
			send: ["audio", "video"] as const,
			receive: ["audio", "video"] as const,
		},
		requested: {
			inCall: true,
			send: { audio: true, video: false },
			receive: { audio: true, video: true },
		},
		mic: "on" as const,
		camera: "off" as const,
		localVideo: undefined,
		problem: undefined,
		remotes: [],
	},
};

describe("controls during room refresh", () => {
	it("plays a card from a phone touch through a table update", async () => {
		await viewport("compact");
		const view = playView();
		const { handlers, section } = renderView(view, "compact");
		await tapThroughUpdate(
			required("[data-testid='hand-N'] [data-card='SA']"),
			() => section.render({ ...view, prompt: "Updated" }),
		);
		expect(handlers.act).toHaveBeenCalledWith({ type: "play", card: "SA" });
	});

	it("opens undo from a phone touch through a table update", async () => {
		await viewport("compact");
		const view = playView();
		const { handlers, section } = renderView(view, "compact");
		const update = () => section.render({ ...view, prompt: "Updated" });
		await tapThroughUpdate(required("[data-testid='undo-request']"), update);
		expect(
			document.querySelector<HTMLDialogElement>("[data-testid='undo-confirm']")
				?.open,
		).toBe(true);
		await tapThroughUpdate(
			required("[data-testid='undo-confirm-send']"),
			update,
		);
		expect(handlers.undoRequest).toHaveBeenCalledWith(view.board);
	});

	it.each(["Claim …", "Claim all"])(
		"opens %s from a phone touch through a table update",
		async (label) => {
			await viewport("compact");
			const base = playView();
			const view = { ...base, claim: { ...base.claim, choosable: true } };
			const { handlers, section } = renderView(view, "compact");
			const update = () => section.render({ ...view, prompt: "Updated" });
			await tapThroughUpdate(playButton(label), update);
			expect(required("[data-testid='claim-confirm']").checkVisibility()).toBe(
				true,
			);
			if (label === "Claim …")
				await tapThroughUpdate(
					required("[data-testid='claim-count-2']"),
					update,
				);
			await tapThroughUpdate(required("[data-testid='claim-confirm']"), update);
			expect(handlers.claimRequest).toHaveBeenCalledWith(
				view.board,
				label === "Claim …" ? 2 : view.claim.maxTricks,
			);
		},
	);

	it("switches phone call audio from a touch through a table update", async () => {
		await viewport("compact");
		const view = playView();
		const { handlers, section } = renderView(view, "compact");
		const compactDisplay = {
			...display,
			view: {
				...display.view,
				form: "compact" as const,
				media: { ...display.view.media, receive: ["audio"] as const },
			},
		};
		section.renderCall(compactDisplay);
		await tapThroughUpdate(
			required(
				".mobile-auction-topbar .call-toggle[data-way='send'][data-medium='audio']",
			),
			() => {
				section.renderCall(compactDisplay);
				section.render({ ...view, prompt: "Updated" });
			},
		);
		expect(handlers.call.setSwitch).toHaveBeenCalledWith(
			"send",
			"audio",
			false,
		);
	});

	it("switches a phone bot from a touch through a host update", async () => {
		await viewport("compact");
		const { handlers, section } = renderView(playView(), "compact");
		section.setBotControls(true, [], false);
		document.body.append(section.hostPlayers);
		required(".mobile-auction-players summary").click();
		await tapThroughUpdate(
			required(".mobile-player-control[data-seat='E'] button"),
			() => section.setBotControls(true, ["S"], false),
		);
		expect(handlers.setBotSeat).toHaveBeenCalledWith("E", true);
	});
	it.each(["desktop", "compact"] as const)(
		"plays a card through an unrelated table update (%s)",
		async (form) => {
			await viewport(form);
			const view = playView();
			const { handlers, section } = renderView(view, form);
			await pressThroughUpdate(
				required("[data-testid='hand-N'] [data-card='SA']"),
				() => section.render({ ...view, prompt: "Updated" }),
			);
			expect(handlers.act).toHaveBeenCalledWith({ type: "play", card: "SA" });
		},
	);

	it.each(["desktop", "compact"] as const)(
		"plays a card when its seat label changes during the press (%s)",
		async (form) => {
			await viewport(form);
			const view = playView();
			const { handlers, section } = renderView(view, form);
			await pressThroughUpdate(
				required("[data-testid='hand-N'] [data-card='SA']"),
				() =>
					section.render({
						...view,
						seats: view.seats.map((seat) =>
							seat.seat === "N" ? { ...seat, label: "N - renamed" } : seat,
						),
					}),
			);
			expect(handlers.act).toHaveBeenCalledWith({ type: "play", card: "SA" });
		},
	);

	it.each(["desktop", "compact"] as const)(
		"plays a dummy card during an unrelated refresh (%s)",
		async (form) => {
			await viewport(form);
			const view = playView();
			const { handlers, section } = renderView(view, form);
			const selector =
				form === "desktop"
					? "[data-testid='hand-S'] [data-card='SA']"
					: ".mobile-board-top [data-card='SA']";
			await pressThroughUpdate(required(selector), () =>
				section.render({ ...view, prompt: "Updated" }),
			);
			expect(handlers.act).toHaveBeenCalledWith({ type: "play", card: "SA" });
		},
	);

	it("removes a departed player's hand from the compact board", () => {
		const view = playView();
		const { section } = renderView(view, "compact");
		section.render({
			...view,
			seats: view.seats.filter((seat) => seat.seat !== "S"),
		});
		expect(document.querySelector(".mobile-board-top .hand")).toBeNull();
	});

	it("switches a desktop bot through an unrelated table update", async () => {
		await viewport("desktop");
		const view = playView();
		const { handlers, section } = renderView(view, "desktop");
		section.setBotControls(true, [], false);
		await pressThroughUpdate(
			required("[data-testid='tile-E'] .tile-bot-control"),
			() => section.render({ ...view, prompt: "Updated" }),
		);
		expect(handlers.setBotSeat).toHaveBeenCalledWith("E", true);
	});

	it("switches a compact bot through the host's regular refresh", async () => {
		await viewport("compact");
		const view = playView();
		const { handlers, section } = renderView(view, "compact");
		section.setBotControls(true, [], false);
		document.body.append(section.hostPlayers);
		required(".mobile-auction-players summary").click();
		await pressThroughUpdate(
			required(".mobile-player-control[data-seat='E'] button"),
			() => section.setBotControls(true, [], false),
		);
		expect(handlers.setBotSeat).toHaveBeenCalledWith("E", true);
	});

	it("keeps another compact bot switch clickable when a different seat changes", async () => {
		await viewport("compact");
		const view = playView();
		const { handlers, section } = renderView(view, "compact");
		section.setBotControls(true, [], false);
		document.body.append(section.hostPlayers);
		required(".mobile-auction-players summary").click();
		await pressThroughUpdate(
			required(".mobile-player-control[data-seat='E'] button"),
			() => section.setBotControls(true, ["S"], false),
		);
		expect(handlers.setBotSeat).toHaveBeenCalledWith("E", true);
	});

	it("keeps a compact bot switch clickable when another player disappears", async () => {
		await page.viewport(1280, 2200);
		const view = playView();
		const { handlers, section } = renderView(view, "compact");
		section.setBotControls(true, [], false);
		document.body.append(section.hostPlayers);
		required(".mobile-auction-players summary").click();
		const target = required(".mobile-player-control[data-seat='E'] button");
		await pressThroughUpdate(target, () => {
			const before = target.getBoundingClientRect();
			section.render({
				...view,
				seats: view.seats.filter((seat) => seat.seat !== "W"),
			});
			const after = target.getBoundingClientRect();
			expect(target.isConnected).toBe(true);
			expect(after.top).toBeCloseTo(before.top, 0);
		});
		expect(handlers.setBotSeat).toHaveBeenCalledWith("E", true);
	});

	it("toggles call audio through a call refresh", async () => {
		const { handlers, section } = renderView(playView(), "desktop");
		section.renderCall(display);
		await pressThroughUpdate(
			required(
				".call-panel .call-toggle[data-way='send'][data-medium='audio']",
			),
			() => section.renderCall(display),
		);
		expect(handlers.call.setSwitch).toHaveBeenCalledWith(
			"send",
			"audio",
			false,
		);
	});

	it.each([
		["send", "audio", false],
		["receive", "audio", false],
		["send", "video", true],
		["receive", "video", false],
	] as const)(
		"toggles desktop call %s %s during refresh",
		async (way, medium, next) => {
			const { handlers, section } = renderView(playView(), "desktop");
			section.renderCall(display);
			await pressThroughUpdate(
				required(
					`.call-panel .call-toggle[data-way='${way}'][data-medium='${medium}']`,
				),
				() => section.renderCall(display),
			);
			expect(handlers.call.setSwitch).toHaveBeenCalledOnce();
			expect(handlers.call.setSwitch).toHaveBeenCalledWith(way, medium, next);
		},
	);

	it.each([
		["send", "audio", false],
		["receive", "audio", false],
		["send", "video", true],
	] as const)(
		"toggles compact call %s %s during refresh",
		async (way, medium, next) => {
			await viewport("compact");
			const { handlers, section } = renderView(playView(), "compact");
			const compactDisplay = {
				...display,
				view: {
					...display.view,
					form: "compact" as const,
					media: { ...display.view.media, receive: ["audio"] as const },
				},
			};
			section.renderCall(compactDisplay);
			await pressThroughUpdate(
				required(
					`.mobile-auction-topbar .call-toggle[data-way='${way}'][data-medium='${medium}']`,
				),
				() => {
					section.renderCall(compactDisplay);
					section.render({ ...playView(), prompt: "Updated" });
				},
			);
			expect(handlers.call.setSwitch).toHaveBeenCalledWith(way, medium, next);
		},
	);

	it("toggles the sideways call controls through a table refresh", async () => {
		await page.viewport(896, 414);
		const view = playView();
		const { handlers, section } = renderView(view, "sideways");
		section.renderCall(display);
		const target = required(
			".sideways-controls .call-toggle[data-way='send'][data-medium='audio']",
		);
		await pressThroughUpdate(target, () => {
			const before = target.getBoundingClientRect();
			section.render({ ...view, prompt: "Updated" });
			expect(target.isConnected).toBe(true);
			expect(target.getBoundingClientRect().top).toBeCloseTo(before.top, 0);
		});
		expect(handlers.call.setSwitch).toHaveBeenCalledWith(
			"send",
			"audio",
			false,
		);
	});

	it("changes the mirror during a call refresh", async () => {
		const { section } = renderView(playView(), "desktop");
		section.renderCall(display);
		const mirror = required(".call-mirror");
		await pressThroughUpdate(mirror, () => section.renderCall(display));
		expect(mirror.getAttribute("aria-pressed")).toBe("false");
	});

	it("leaves the call during a call refresh", async () => {
		const { handlers, section } = renderView(playView(), "desktop");
		section.renderCall(display);
		await pressThroughUpdate(required(".call-panel .call-join"), () =>
			section.renderCall(display),
		);
		expect(handlers.call.leave).toHaveBeenCalledOnce();
	});

	it("toggles audio in the invitation during a call refresh", async () => {
		const { handlers, section } = renderView(playView(), "desktop");
		const outside = {
			...display,
			view: {
				...display.view,
				status: "outside" as const,
				mic: "off" as const,
				requested: { ...display.view.requested, inCall: false },
			},
		};
		section.renderCall(outside, {}, true);
		await pressThroughUpdate(
			required(
				".call-invite .call-toggle[data-way='send'][data-medium='audio']",
			),
			() => section.renderCall(outside, {}, true),
		);
		expect(handlers.call.setSwitch).toHaveBeenCalledWith(
			"send",
			"audio",
			false,
		);
	});

	it("joins from the invitation during a call refresh", async () => {
		const { handlers, section } = renderView(playView(), "desktop");
		const outside = {
			...display,
			view: {
				...display.view,
				status: "outside" as const,
				mic: "off" as const,
				requested: { ...display.view.requested, inCall: false },
			},
		};
		section.renderCall(outside, {}, true);
		await pressThroughUpdate(required(".call-invite .call-join"), () =>
			section.renderCall(outside, {}, true),
		);
		expect(handlers.call.join).toHaveBeenCalledOnce();
	});

	it("retries a failed call during a call refresh", async () => {
		const { handlers, section } = renderView(playView(), "desktop");
		const failed = {
			...display,
			view: {
				...display.view,
				remotes: [
					{
						seat: "E" as const,
						status: "unavailable" as const,
						audio: undefined,
						video: undefined,
						peerSendsAudio: true,
						peerReceivesAudio: true,
						peerSendsVideo: false,
						fault: undefined,
					},
				],
			},
		};
		section.renderCall(failed);
		await pressThroughUpdate(required("[data-testid='call-retry-E']"), () =>
			section.renderCall(failed),
		);
		expect(handlers.call.retry).toHaveBeenCalledWith("E");
	});

	it("does not play a card that becomes unplayable during the press", async () => {
		const view = playView();
		const { handlers, section } = renderView(view, "desktop");
		await pressThroughUpdate(
			required("[data-testid='hand-N'] [data-card='SA']"),
			() =>
				section.render({
					...view,
					seats: view.seats.map((seat) =>
						seat.seat === "N" && seat.hand.visible
							? {
									...seat,
									hand: {
										...seat.hand,
										suits: seat.hand.suits.map((suit) => ({
											...suit,
											cards: suit.cards.map((card) => ({
												...card,
												playable: false,
											})),
										})),
									},
								}
							: seat,
					),
				}),
		);
		expect(handlers.act).not.toHaveBeenCalled();
	});

	it("keeps claim counts clickable through an unrelated table update", async () => {
		const base = playView();
		const view = { ...base, claim: { ...base.claim, choosable: true } };
		const { section } = renderView(view, "desktop");
		const claim = [
			...document.querySelectorAll<HTMLElement>(".play-controls button"),
		].find((node) => node.textContent === "Claim …");
		if (!claim) throw new Error("Missing claim button");
		claim.click();
		await pressThroughUpdate(required("[data-testid='claim-count-2']"), () =>
			section.render({ ...view, prompt: "Updated" }),
		);
		expect(
			required("[data-testid='claim-count-2']").getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("opens undo through an unrelated table update", async () => {
		const view = playView();
		const { section } = renderView(view, "desktop");
		await pressThroughUpdate(required("[data-testid='undo-request']"), () =>
			section.render({ ...view, prompt: "Updated" }),
		);
		expect(
			document.querySelector<HTMLDialogElement>("[data-testid='undo-confirm']")
				?.open,
		).toBe(true);
	});

	it.each(["desktop", "compact"] as const)(
		"opens bidding undo when its status text changes during the press (%s)",
		async (form) => {
			await viewport(form);
			const base = playView();
			const view = {
				...base,
				phase: "auction" as const,
				bids: [{ call: "P" as const, text: "Pass" }],
			};
			const { section } = renderView(view, form);
			await pressThroughUpdate(required("[data-testid='auction-undo']"), () =>
				section.render({
					...view,
					undo: { ...view.undo, message: "Status updated" },
				}),
			);
			expect(
				document.querySelector<HTMLDialogElement>(
					"[data-testid='undo-confirm']",
				)?.open,
			).toBe(true);
		},
	);

	it.each(["desktop", "compact"] as const)(
		"selects a bid level when the undo status changes during the press (%s)",
		async (form) => {
			await viewport(form);
			const base = playView();
			const view = {
				...base,
				phase: "auction" as const,
				bids: [{ call: "1C" as const, text: "1♣" }],
			};
			const { section } = renderView(view, form);
			const level = required(".bid-levels button");
			await pressThroughUpdate(level, () => {
				const before = level.getBoundingClientRect();
				section.render({
					...view,
					undo: { ...view.undo, message: "Status updated" },
				});
				expect(level.isConnected).toBe(true);
				expect(level.getBoundingClientRect().top).toBeCloseTo(before.top, 0);
			});
			expect(required(".bid-levels button").getAttribute("aria-pressed")).toBe(
				"true",
			);
		},
	);

	it.each(["desktop", "compact"] as const)(
		"selects a bid level when the bot hint arrives during the press (%s)",
		async (form) => {
			await viewport(form);
			const base = playView();
			const view = {
				...base,
				phase: "auction" as const,
				bids: [{ call: "1C" as const, text: "1♣" }],
			};
			const { section } = renderView(view, form);
			await pressThroughUpdate(required(".bid-levels button"), () =>
				section.showBotBid("1C"),
			);
			expect(required(".bid-levels button").getAttribute("aria-pressed")).toBe(
				"true",
			);
		},
	);

	it("sends the confirmed undo through an unrelated table update", async () => {
		const view = playView();
		const { handlers, section } = renderView(view, "desktop");
		required("[data-testid='undo-request']").click();
		await pressThroughUpdate(
			required("[data-testid='undo-confirm-send']"),
			() => section.render({ ...view, prompt: "Updated" }),
		);
		expect(handlers.undoRequest).toHaveBeenCalledWith(view.board);
	});

	it("opens and confirms undo on a phone through table updates", async () => {
		await viewport("compact");
		const view = playView();
		const { handlers, section } = renderView(view, "compact");
		const update = () => section.render({ ...view, prompt: "Updated" });
		await pressThroughUpdate(required("[data-testid='undo-request']"), update);
		expect(
			document.querySelector<HTMLDialogElement>("[data-testid='undo-confirm']")
				?.open,
		).toBe(true);
		await pressThroughUpdate(
			required("[data-testid='undo-confirm-send']"),
			update,
		);
		expect(handlers.undoRequest).toHaveBeenCalledWith(view.board);
	});

	it("chooses and confirms a partial claim on a phone through table updates", async () => {
		await viewport("compact");
		const base = playView();
		const view = { ...base, claim: { ...base.claim, choosable: true } };
		const { handlers, section } = renderView(view, "compact");
		const update = () => section.render({ ...view, prompt: "Updated" });
		await pressThroughUpdate(playButton("Claim …"), update);
		await pressThroughUpdate(required("[data-testid='claim-count-2']"), update);
		expect(
			required("[data-testid='claim-count-2']").getAttribute("aria-pressed"),
		).toBe("true");
		await pressThroughUpdate(required("[data-testid='claim-confirm']"), update);
		expect(handlers.claimRequest).toHaveBeenCalledWith(view.board, 2);
	});

	it("opens and confirms claim all on a phone through table updates", async () => {
		await viewport("compact");
		const view = playView();
		const { handlers, section } = renderView(view, "compact");
		const update = () => section.render({ ...view, prompt: "Updated" });
		await pressThroughUpdate(playButton("Claim all"), update);
		await pressThroughUpdate(required("[data-testid='claim-confirm']"), update);
		expect(handlers.claimRequest).toHaveBeenCalledWith(
			view.board,
			view.claim.maxTricks,
		);
	});

	it.each(["desktop", "compact"] as const)(
		"confirms a claim through an unrelated table update (%s)",
		async (form) => {
			await viewport(form);
			const view = playView();
			const { handlers, section } = renderView(view, form);
			playButton("Claim all").click();
			await pressThroughUpdate(required("[data-testid='claim-confirm']"), () =>
				section.render({ ...view, prompt: "Updated" }),
			);
			expect(handlers.claimRequest).toHaveBeenCalledWith(
				view.board,
				view.claim.maxTricks,
			);
		},
	);

	it.each(["desktop", "compact"] as const)(
		"accepts an undo request through an unrelated table update (%s)",
		async (form) => {
			await viewport(form);
			const base = playView();
			const view = {
				...base,
				undo: {
					...base.undo,
					canRequest: false,
					canVote: true,
					requestId: "undo-1",
					message: "Approve undo?",
				},
			};
			const { handlers, section } = renderView(view, form);
			await pressThroughUpdate(
				required("[data-testid='approval-accept']"),
				() => section.render({ ...view, prompt: "Updated" }),
			);
			expect(handlers.undoVote).toHaveBeenCalledWith("undo-1", true);
		},
	);

	it.each(["desktop", "compact"] as const)(
		"rejects a claim through an unrelated table update (%s)",
		async (form) => {
			await viewport(form);
			const base = playView();
			const view = {
				...base,
				undo: { ...base.undo, canRequest: false },
				claim: {
					...base.claim,
					canRequest: false,
					canVote: true,
					requestId: "claim-1",
					message: "Accept claim?",
				},
			};
			const { handlers, section } = renderView(view, form);
			await pressThroughUpdate(
				required("[data-testid='approval-reject']"),
				() => section.render({ ...view, prompt: "Updated" }),
			);
			expect(handlers.claimVote).toHaveBeenCalledWith("claim-1", false);
		},
	);
});
