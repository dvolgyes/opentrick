import {
	configuredBotSeats,
	HostBotRunner,
	type HostBotSettings,
} from "../bot/host-runner";
import { type Board, boardStatus } from "../bridge/engine";
import type { PointSystem } from "../bridge/hand-points";
import { type BuildInfo, formatBuildDate } from "../build";
import { CallController } from "../call/call";
import {
	formOf,
	isTouchDevice,
	type Layout,
	layout,
	readSignals,
	watchDeviceClass,
} from "../call/device-class";
import { createCallSignaling } from "../call/signaling";
import {
	actionPayload,
	claimRequestPayload,
	claimVotePayload,
	dealPayload,
	parseBridgeState,
	resetCancelPayload,
	resetRequestPayload,
	resetVotePayload,
	systemPayload,
	undoCancelPayload,
	undoRequestPayload,
	undoVotePayload,
} from "../game/bridge";
import { chatPayload, checkMessageText } from "../game/chat";
import { tableLink } from "../p2p/link";
import type { TableController, TableStatus } from "../p2p/table";
import type { PlayerProfiles } from "../players";
import {
	DEFAULT_BOT_SETUP,
	type JsonObject,
	type LocalBidder,
	type RoomConfig,
	SEATS,
	type Seat,
} from "../protocol";
import { botSeatsQuery, parseAutoplaySeats, sharedQuery } from "./bookmark";
import { CallMemory } from "./call-memory";
import type { CallDisplay, RemoteCallPresence } from "./call-model";
import { cameraSetup } from "./camera-setup";
import { debugExport, pageAddress } from "./debug-export";
import type { AppDeps, Dispose, Navigation } from "./deps";
import { button, copyWhenReady, el } from "./dom";
import { languageControl } from "./language-control";
import {
	type Banner,
	bannerFor,
	bannerText,
	botPlays,
	callSeats,
	connectionDetail,
	draftFor,
	heldSeats,
	networkLines,
	type PendingLine,
	presentSeats,
	type RosterRow,
	releaseText,
	roomView,
	type SummaryInput,
	storageNotice,
	submitText,
	TEXT,
	type TranscriptLine,
} from "./model";
import { networkPanel } from "./network";
import { pageReport, type TableFacts } from "./page-report";
import { pageTitle } from "./page-title";
import { playerEditor } from "./player-editor";
import { remoteAudio } from "./remote-audio";
import { readSettings } from "./settings";
import { settingsDialog } from "./settings-dialog";
import { tableSection } from "./table";
import { autoDealBoard, tableView } from "./table-model";
import type { TurnSound } from "./turn-sound";
import { voiceMeters } from "./voice-meter";
import { screenWakeLock, WakeLockPolicy } from "./wake-lock";

export interface RoomScreenHandlers extends Navigation {
	/** Tries to claim this seat again after it becomes available. */
	retrySeat(): void;
	/** Shared by the lobby and room so a seat-selection gesture unlocks turn alerts. */
	turnSound: TurnSound;
}

const STATE_TEXT: Readonly<Record<RosterRow["state"], string>> = {
	online: "Online",
	offline: "Offline",
	free: "Free",
};

function roomShareLink(
	pageUrl: string,
	key: string,
	players?: PlayerProfiles,
): string {
	const page = new URL(pageUrl);
	page.search = sharedQuery(page.search, players);
	return tableLink(page.toString(), key);
}

function settingsFor(
	config: RoomConfig | undefined,
	playTimeMs?: number,
): HostBotSettings {
	return { bidder: (config?.botSetup ?? DEFAULT_BOT_SETUP).bidder, playTimeMs };
}

/** After these, the room stays on the screen but can no longer act. */
const TERMINAL: ReadonlySet<TableStatus> = new Set([
	"expired",
	"superseded",
	"incompatible",
]);

/** How long the Debug button waits for the players' new reports before it copies the export. */
const REPORT_WAIT_MS = 1_500;

function botsPausedStorageKey(tableId: string): string {
	return `opentrick.bots-paused.${tableId}`;
}

/**
 * The room screen of the seat that this page holds. It renders the controller's view and sends through the
 * controller; the caller owns the controller and stops it.
 */
export function showRoom(
	root: HTMLElement,
	deps: AppDeps,
	controller: TableController,
	key: string,
	seat: Seat,
	handlers: RoomScreenHandlers,
	fallbackConfig?: RoomConfig,
	autoCopy?: Promise<string>,
	initialBotSettings?: HostBotSettings,
): Dispose {
	const tableId = controller.tableId;
	let disposed = false;
	// The screen stays on during the bidding and the play, so a phone or tablet does not sleep in the middle of a board.
	const wakeLock = new WakeLockPolicy(screenWakeLock);

	// The call is optional and separate from the game: it reads the table, and its actions never send a command.
	const deviceLayout = layout(readSignals(window), readSettings(deps.browser));
	const deviceForm = formOf(deviceLayout);
	const support = deps.call;
	const camera = support.available
		? cameraSetup({
				devices: support.cameras,
				getUserMedia: support.getUserMedia,
				t: deps.t,
			})
		: undefined;
	const call = support.available
		? new CallController(
				{
					openSignaling: (inbox, callHandlers) =>
						createCallSignaling(controller.callTransport, inbox, callHandlers),
					getUserMedia: support.getUserMedia,
					createConnection: support.createConnection,
					newSession: support.newSession,
				},
				deviceForm,
			)
		: undefined;
	const memory =
		support.available && call !== undefined
			? new CallMemory({
					call,
					tableId,
					seat,
					holder: controller.holder,
					granted: support.granted,
					send: (payload) => controller.send(payload).then((sent) => sent.ok),
					changed: () => renderCall(),
				})
			: undefined;
	const unsubscribeCamera = camera?.onChange(() => renderCall());
	const audio = remoteAudio();
	const voices = voiceMeters();
	const { turnSound: turnAlert } = handlers;
	let yourTurn = false;
	let currentTurnKey: string | undefined;
	let alertedTurn: string | undefined;
	let botRunner: HostBotRunner | undefined;
	const delegatedBotSeats = new Set<Seat>();
	/** A bot that the host chose plays this page's seat. */
	let botHoldsSeat = false;
	let botStarting = false;
	let botAutoAttempted = false;
	let botRestoreStarted = false;
	let botRestorePending = false;
	let botsPaused = readBotsPaused();
	let remoteCallPresence: Partial<Record<Seat, RemoteCallPresence>> = {};
	/** A guest's page sees the host in the room call: the call controls invite this player. */
	let hostInCall = false;
	const botSeatOverrides = new Map<Seat, boolean>();
	let botSettings = initialBotSettings;
	let playerAutoplayPending = false;
	let playerAutoplayStatus = "";
	let playerAutoplayWasEnabled = false;
	let playerAutoplayConfirmedRoster = false;
	/**
	 * The roster shown when the host answered this player's last autoplay request. The host sends rosters and answers
	 * on one ordered channel and builds each roster when it sends it, so only a later roster shows the seat after the
	 * answer.
	 */
	let playerAutoplayAnswerRoster: unknown;
	let playerAutoplayHost = "";
	let shownModel: ReturnType<typeof tableView> | undefined;

	function tableFacts(): TableFacts | null {
		if (!shownModel) return null;
		const view = controller.view();
		return {
			seat,
			phase: shownModel.phase,
			board: shownModel.board,
			at: shownModel.at,
			yourTurn: shownModel.yourTurn,
			outbox: view.outbox.length,
			failures: view.failures.length,
			undone: view.undone.length,
		};
	}

	function debugText(asked: number): string {
		const view = controller.view();
		const exported = debugExport({
			exportedAt: Date.now(),
			build: deps.build,
			page: pageAddress(location.href),
			hostSeat: seat,
			host: pageReport(window, deviceForm, tableFacts()),
			bots: view.roster?.bots ?? [],
			reports: controller.reports(),
			asked,
			view,
			entries: controller.entries(),
		});
		return JSON.stringify(exported, null, 2);
	}

	/** The reload button's tooltip lists each seat's build; it is marked when a player's build is not the host's. */
	function showPlayerBuilds(bots: readonly Seat[]): void {
		const reports = controller.reports();
		const buildText = (build: BuildInfo): string =>
			`${formatBuildDate(build.date)} (${build.commit})`;
		reloadPlayers.title = SEATS.map((target) => {
			const report = reports.find((item) => item.seat === target);
			const text =
				target === seat
					? buildText(deps.build)
					: report
						? buildText(report.build)
						: bots.includes(target)
							? deps.t("Bot")
							: deps.t("no report");
			return `${deps.t(target)}: ${text}`;
		}).join("\n");
		reloadPlayers.dataset.outdated = String(
			reports.some((report) => report.build.commit !== deps.build.commit),
		);
	}

	controller.setReportSource(() =>
		disposed
			? undefined
			: {
					build: deps.build,
					detail: pageReport(window, deviceForm, tableFacts()),
				},
	);
	// The page fetches itself past the HTTP cache first, so the reload gets the site's latest build.
	controller.setReloadHandler(() => {
		if (disposed) return;
		void fetch(location.href, { cache: "reload" })
			.catch(() => undefined)
			.finally(() => location.reload());
	});

	controller.setAutoplayHandler(async (targetSeat, enabled) => {
		if (!controller.view().hosting) return "failed";
		if (!enabled) {
			if (!delegatedBotSeats.has(targetSeat)) return "disabled";
			const ok = await controller.setBotSeat(targetSeat, false);
			if (!ok) return "failed";
			delegatedBotSeats.delete(targetSeat);
			botSeatOverrides.delete(targetSeat);
			botRunner?.setSeatEnabled(targetSeat, false);
			return "disabled";
		}
		botSettings ??= settingsFor(
			fallbackConfig ?? controller.view().table?.config,
			readSettings(deps.browser).playTimeMs,
		);
		const enabledSeat = await controller.setBotSeat(targetSeat, true);
		if (!enabledSeat) return "failed";
		delegatedBotSeats.add(targetSeat);
		botSeatOverrides.delete(targetSeat);
		if (botRunner) {
			botRunner.setSeatEnabled(targetSeat, true);
			setBotsPaused(false);
			botRunner.resume();
			botStatus.textContent = deps.t("Autoplay uses the local bridge engine.");
			return "enabled";
		}
		setBotsPaused(false);
		const started = await startHostBots(targetSeat);
		if (!started) {
			delegatedBotSeats.delete(targetSeat);
			await controller.setBotSeat(targetSeat, false);
			return "failed";
		}
		botStatus.textContent = deps.t("Autoplay uses the local bridge engine.");
		return "enabled";
	});

	const you = el("p", { className: "you", attrs: { "data-testid": "you" } });
	const bannerLine = el("span", {});
	const becomeHost = button(deps.t(TEXT.becomeHost), () => controller.click(), {
		attrs: { "data-testid": "become-host" },
	});
	const bannerHint = el("span", { className: "note" });
	const bannerDetail = el("span", {
		className: "note detail",
		attrs: { "data-testid": "banner-detail" },
	});
	const retrySeat = button(deps.t("Try seat again"), handlers.retrySeat, {
		attrs: { "data-testid": "retry-seat" },
	});
	const createNew = button(deps.t("Create new game"), handlers.createNew);
	const botStatus = el("p", {
		className: "bot-status",
		attrs: { role: "status", "data-testid": "bot-status" },
	});
	const settings = settingsDialog(deps, handlers.reload, applySettings, () => ({
		bidder: (
			botSettings ??
			settingsFor(fallbackConfig ?? controller.view().table?.config)
		).bidder,
		editable: controller.view().hosting,
	}));

	function applySettings(bidder?: LocalBidder): void {
		if (bidder !== undefined && controller.view().hosting) {
			botSettings = {
				...(botSettings ?? settingsFor(controller.view().table?.config)),
				bidder,
			};
			const query = new URLSearchParams(location.search);
			query.set("bot_bidder", bidder);
			history.replaceState(
				null,
				"",
				`${location.pathname}?${query}${location.hash}`,
			);
		}
		if (botSettings) {
			botSettings = {
				...botSettings,
				playTimeMs: readSettings(deps.browser).playTimeMs,
			};
			botRunner?.updateSettings(botSettings);
			if (botRunner && !botsPaused) botStatus.textContent = runningBotStatus();
		}
		// A new orientation choice changes the view at once.
		deviceWatch.check();
		// The table reads the display settings when it renders, so it renders again although its view did not change.
		shownTable = undefined;
		render();
	}
	const banner = el(
		"div",
		{ className: "banner", attrs: { role: "status", "data-testid": "banner" } },
		bannerLine,
		becomeHost,
		bannerHint,
		retrySeat,
		createNew,
		bannerDetail,
	);
	const actionNote = el("p", {
		className: "note",
		attrs: { role: "status", "data-testid": "action-note" },
	});
	const keepOpen = el(
		"p",
		{ className: "note keep-open", attrs: { "data-testid": "keep-open" } },
		deps.t(TEXT.keepOpen),
	);
	const roster = el("ul", {
		className: "roster",
		attrs: { "data-testid": "roster" },
	});
	const rosterNote = el("p", { className: "note", attrs: { role: "status" } });
	const allConnected = el(
		"p",
		{ className: "note", attrs: { "data-testid": "all-connected" } },
		deps.t("All players connected"),
	);
	const transcript = el("ol", {
		className: "transcript",
		attrs: { "data-testid": "transcript" },
	});
	const pending = el("ul", {
		className: "pending",
		attrs: { "data-testid": "pending" },
	});
	const draft = el("textarea", {
		attrs: {
			rows: "2",
			"aria-label": deps.t("Message"),
			"data-testid": "draft",
		},
	});
	draft.value = draftFor(seat);
	const send = el("button", {
		attrs: { type: "submit", "data-testid": "send" },
	});
	const sendNote = el("p", { className: "note", attrs: { role: "status" } });
	const form = el("form", { className: "send" }, draft, send, sendNote);
	const network = networkPanel(deps.t);

	let sendError: string | undefined;
	let actionError: string | undefined;
	let releaseError: string | undefined;
	let confirming: Seat | undefined;
	/** The browser's answer to the persistence request (plan §4.3). */
	let persisted: boolean | undefined;
	/** The board as last rendered: an action is sent for the position the player saw. */
	let shownBoard: Board | null = null;
	/** The view models as last rendered. The controller notifies every tick; equal models keep their nodes. */
	let shownRoom: string | undefined;
	let shownTable: string | undefined;
	let scoringBoard: number | undefined;
	let scoringStartedAt: number | undefined;
	let scoringTimer: number | undefined;
	let autoDealtBoard: number | undefined;
	let resetRequestId: string | undefined;

	/** Stores the command for sending; `onFail` gets the reason when this browser could not store it. */
	const submit = (
		payload: JsonObject,
		onFail: (reason: string) => void,
	): void => {
		void controller.send(payload).then((result) => {
			if (disposed) return;
			if (!result.ok) onFail(submitText(result, deps.t));
			render();
		});
	};

	const dealBoard = (board: number, onFail?: () => void): void => {
		actionError = undefined;
		submit(dealPayload(tableId, board), (reason) => {
			actionError = deps.t("Not sent: {reason}", { reason });
			onFail?.();
		});
		render();
	};
	/** The host deals the first board once all four seats are filled, again after a reset that keeps no board. */
	let firstDealSent = false;
	/** The bidding system that this page sent for its seat; sent once, so a host that rejects it gets no resend loop. */
	let sentSystem: PointSystem | undefined;

	function manageBotSeat(targetSeat: Seat, enabled: boolean): void {
		void controller.setBotSeat(targetSeat, enabled).then((ok) => {
			if (!ok) {
				botStatus.textContent = deps.t("The host could not change that seat.");
				return;
			}
			botSeatOverrides.set(targetSeat, enabled);
			const currentView = controller.view();
			const currentBots = new Set(currentView.roster?.bots ?? []);
			if (enabled) currentBots.add(targetSeat);
			else currentBots.delete(targetSeat);
			rememberBotSeats([...currentBots]);
			if (enabled) {
				botRunner?.setSeatEnabled(targetSeat, true);
				if (botRunner) {
					setBotsPaused(false);
					botRunner.resume();
				} else {
					setBotsPaused(false);
					void startHostBots(targetSeat);
				}
			} else {
				botRunner?.setSeatEnabled(targetSeat, false);
			}
			if (botRunner)
				botStatus.textContent = botsPaused
					? deps.t("Bots paused.")
					: runningBotStatus();
			render();
		});
	}

	/** A reload keeps the bots stopped when this host paused them or they stopped on an error. */
	function readBotsPaused(): boolean {
		try {
			return deps.browser?.getItem(botsPausedStorageKey(tableId)) === "1";
		} catch {
			return false;
		}
	}

	function setBotsPaused(paused: boolean): void {
		botsPaused = paused;
		try {
			if (paused) deps.browser?.setItem(botsPausedStorageKey(tableId), "1");
			else deps.browser?.removeItem(botsPausedStorageKey(tableId));
		} catch {
			// The pause remains in effect until this page closes if storage is unavailable.
		}
	}

	function effectiveBotSeats(): Seat[] {
		const view = controller.view();
		const config = view.table?.config ?? fallbackConfig;
		const active = new Set(
			view.roster?.bots ?? (config ? configuredBotSeats(config) : []),
		);
		for (const [targetSeat, enabled] of botSeatOverrides) {
			if (enabled) active.add(targetSeat);
			else active.delete(targetSeat);
		}
		return SEATS.filter((targetSeat) => active.has(targetSeat));
	}

	function runningBotStatus(): string {
		const count = effectiveBotSeats().length;
		return count === 0
			? deps.t("No bot seats are active.")
			: deps.t("Running {count} bot seat(s) with {engine}.", {
					count,
					engine: `Local BRL · ${(botSettings ?? settingsFor(controller.view().table?.config)).bidder}`,
				});
	}

	function rememberBotSeats(bots: readonly Seat[]): void {
		const query = botSeatsQuery(
			location.search,
			bots,
			controller.view().roster?.autoplaySeats ?? [],
		);
		history.replaceState(
			null,
			"",
			`${location.pathname}?${query}${location.hash}`,
		);
	}

	async function restoreBotSeats(bots: readonly Seat[]): Promise<void> {
		const desired = new Set(bots);
		const autoplay = parseAutoplaySeats(location.search);
		for (const targetSeat of SEATS) {
			const current =
				controller.view().roster?.bots.includes(targetSeat) ?? false;
			if (current !== desired.has(targetSeat)) {
				const ok = await controller.setBotSeat(
					targetSeat,
					desired.has(targetSeat),
				);
				if (!ok) {
					botStatus.textContent = deps.t(
						"The host could not restore the saved bot seats.",
					);
					break;
				}
				botSeatOverrides.set(targetSeat, desired.has(targetSeat));
			}
			// The player of this seat asked for the bot before the reload, so the player stays at the table and can stop it.
			if (
				desired.has(targetSeat) &&
				autoplay.includes(targetSeat) &&
				controller.restoreAutoplay(targetSeat)
			)
				delegatedBotSeats.add(targetSeat);
		}
		botRestorePending = false;
		render();
	}

	const table = tableSection(
		{
			exit: handlers.createNew,
			reload: handlers.reload,
			async shareUrl() {
				if (navigator.share === undefined)
					throw new Error("Web Share API is unavailable");
				await navigator.share({
					url: roomShareLink(
						deps.pageUrl(),
						key,
						controller.view().table?.players,
					),
				});
			},
			act(action) {
				if (!shownBoard) return;
				actionError = undefined;
				submit(actionPayload(tableId, shownBoard, action), (reason) => {
					actionError = deps.t("Not sent: {reason}", { reason });
				});
				render();
			},
			undoRequest(board) {
				actionError = undefined;
				submit(undoRequestPayload(tableId, board), (reason) => {
					actionError = deps.t("Undo not sent: {reason}", { reason });
				});
				render();
			},
			undoVote(requestId, approve) {
				actionError = undefined;
				submit(undoVotePayload(tableId, requestId, approve), (reason) => {
					actionError = deps.t("Undo vote not sent: {reason}", { reason });
				});
				render();
			},
			undoCancel(requestId) {
				actionError = undefined;
				submit(undoCancelPayload(tableId, requestId), (reason) => {
					actionError = deps.t("Undo cancellation not sent: {reason}", {
						reason,
					});
				});
				render();
			},
			claimRequest(board, tricks) {
				actionError = undefined;
				submit(claimRequestPayload(tableId, board, tricks), (reason) => {
					actionError = deps.t("Claim not sent: {reason}", { reason });
				});
				render();
			},
			claimVote(requestId, approve) {
				actionError = undefined;
				submit(claimVotePayload(tableId, requestId, approve), (reason) => {
					actionError = deps.t("Claim decision not sent: {reason}", { reason });
				});
				render();
			},
			setBotSeat(targetSeat, enabled) {
				manageBotSeat(targetSeat, enabled);
			},
			requestAutoplay(enabled) {
				playerAutoplayPending = true;
				playerAutoplayStatus = deps.t("Sending autoplay request…");
				render();
				void controller.requestAutoplay(enabled).then((status) => {
					playerAutoplayPending = false;
					if (status === "enabled") {
						playerAutoplayWasEnabled = true;
						playerAutoplayAnswerRoster = controller.view().roster;
						playerAutoplayStatus = deps.t("The host is playing your seat.");
					} else if (status === "disabled") {
						playerAutoplayWasEnabled = false;
						playerAutoplayConfirmedRoster = false;
						playerAutoplayAnswerRoster = controller.view().roster;
						playerAutoplayStatus = deps.t("Autoplay stopped.");
					} else if (status === "unavailable") {
						playerAutoplayWasEnabled = false;
						playerAutoplayStatus = deps.t(
							"Autoplay is unavailable on this host.",
						);
					} else {
						playerAutoplayStatus = deps.t("Autoplay request failed.");
					}
					render();
				});
			},
			// Only these explicit actions change the stored call status.
			call: {
				join: (selection) => {
					if (selection.send.video && camera?.available !== false) {
						void camera?.open().then((chosen) => {
							if (chosen === undefined || call === undefined) return;
							// Cancel joins with the other switches; without a prepared camera the call sends no video.
							if (chosen !== "cancelled") {
								call.setVideoDevice(chosen.deviceId);
								if (!call.prepareVideo(chosen.track)) {
									chosen.track.stop();
									return;
								}
							}
							call.join(selection);
							memory?.acted();
						});
						return;
					}
					const effective =
						selection.send.video && camera?.available === false
							? { ...selection, send: { ...selection.send, video: false } }
							: selection;
					call?.join(effective);
					memory?.acted();
				},
				leave: () => {
					call?.leave();
					memory?.acted();
				},
				setSwitch: (way, medium, on) => {
					if (
						way === "send" &&
						medium === "video" &&
						on &&
						call?.view.requested.inCall
					) {
						if (camera?.available === false) return;
						void camera?.open().then((chosen) => {
							if (
								chosen === undefined ||
								chosen === "cancelled" ||
								call === undefined
							)
								return;
							call.setVideoDevice(chosen.deviceId);
							if (!call.prepareVideo(chosen.track)) {
								chosen.track.stop();
								return;
							}
							call.setSwitch(way, medium, true);
							memory?.acted();
						});
						return;
					}
					call?.setSwitch(way, medium, on);
					memory?.acted();
				},
				retry: (target) => call?.retry(target),
			},
		},
		undefined,
		deps.t,
		{
			pointSystem: () => readSettings(deps.browser).pointSystem,
			cardPoints: () => readSettings(deps.browser).cardPoints,
			locale: deps.locale,
			marks: () => readSettings(deps.browser),
			voiceMeters: voices,
		},
	);

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const check = checkMessageText(draft.value);
		if (!check.ok) {
			sendError = deps.t("Not sent: {reason}.", { reason: check.reason });
			render();
			return;
		}
		const text = draft.value;
		draft.value = "";
		sendError = undefined;
		submit(chatPayload(tableId, check.text), (reason) => {
			sendError = deps.t("Not sent: {reason}", { reason });
			if (draft.value === "") draft.value = text;
		});
		render();
	});

	const release = (target: Seat): void => {
		confirming = undefined;
		releaseError = controller.release(target)
			? undefined
			: deps.t("Release failed: no host is connected. Try again later.");
		render();
	};

	const links = el(
		"section",
		{ className: "links" },
		el(
			"p",
			{},
			deps.t(
				"Send this link to the three other players. Each one opens it and takes a seat.",
			),
		),
		button(deps.t("Copy table link"), async () => {
			try {
				await navigator.clipboard.writeText(
					roomShareLink(deps.pageUrl(), key, controller.view().table?.players),
				);
			} catch {
				// This secondary link control has no status text.
			}
		}),
	);
	// A phone or tablet opens its share sheet, where the person picks the app that sends the link; a computer copies it.
	const nativeShare =
		navigator.share !== undefined && isTouchDevice(readSignals(window));
	const copyRoomLink = button(
		deps.t(nativeShare ? "Share URL" : "Copy link"),
		async () => {
			const link = roomShareLink(
				deps.pageUrl(),
				key,
				controller.view().table?.players,
			);
			if (nativeShare) {
				// The share starts before the first await, while the browser still counts the tap as the person's.
				// A share that the person cancels is done too; a refused one copies the link instead.
				const done = await navigator.share({ url: link }).then(
					() => true,
					(error: unknown) =>
						error instanceof DOMException && error.name === "AbortError",
				);
				if (done) return;
			}
			try {
				await navigator.clipboard.writeText(link);
				turnAlert.beep();
			} catch {
				// Clipboard failure stays silent, and does not signal success.
			}
		},
		{
			className: "sidebar-copy-link",
			attrs: { "data-testid": "copy-board-url" },
		},
	);
	if (autoCopy)
		void autoCopy.then(
			(message) => {
				if (message === "Copied.") turnAlert.beep();
			},
			() => undefined,
		);
	const debugStatus = el("p", {
		className: "note debug-status",
		attrs: { role: "status", "data-testid": "debug-status" },
	});
	// The host asks for new reports and copies the export once they had time to arrive; the copy starts in the click.
	const debug = button(
		deps.t("Debug"),
		() => {
			const asked = controller.requestReports();
			debugStatus.textContent = deps.t("Collecting the players' reports…");
			const text = new Promise<string>((resolve) => {
				window.setTimeout(
					() => resolve(debugText(asked)),
					asked > 0 ? REPORT_WAIT_MS : 0,
				);
			});
			void copyWhenReady(text).then((result) => {
				debugStatus.textContent = deps.t(
					result === "copied"
						? "Debug export copied."
						: result === "unavailable"
							? "Clipboard access is unavailable."
							: "Could not copy the debug export. Allow clipboard access and try again.",
				);
			});
		},
		{ attrs: { "data-testid": "debug-export" } },
	);
	const reloadPlayers = button(
		deps.t("Reload players"),
		() => {
			debugStatus.textContent = deps.t("Asked {count} pages to reload.", {
				count: controller.reloadPlayers(),
			});
		},
		{ attrs: { "data-testid": "reload-players" } },
	);
	const openSettings = button(deps.t("Settings"), () => settings.open(), {
		className: "settings-button",
	});
	// Reset closes the dialog, so the host sees who must approve the reset.
	const reset = button(deps.t("Reset"), () => {
		hostControls.close();
		actionError = undefined;
		submit(resetRequestPayload(tableId), (reason) => {
			actionError = deps.t("Reset not sent: {reason}", { reason });
		});
	});
	const players = playerEditor(deps, controller, (target) =>
		manageBotSeat(target, false),
	);
	const hostControls = el(
		"dialog",
		{
			className: "host-controls-dialog",
			attrs: {
				"aria-labelledby": "host-controls-title",
				"data-testid": "host-controls-dialog",
			},
		},
		el("h2", { attrs: { id: "host-controls-title" } }, deps.t("Host controls")),
		el(
			"div",
			{ className: "host-controls-actions" },
			debug,
			reloadPlayers,
			reset,
			button(
				deps.t("Player names"),
				() => {
					hostControls.close();
					players.open();
				},
				{ attrs: { "data-testid": "edit-player-names" } },
			),
		),
		debugStatus,
		el(
			"div",
			{ className: "host-controls-close" },
			button(deps.t("Close"), () => hostControls.close()),
		),
	);
	const openHostControls = button(
		deps.t("Host controls"),
		() => hostControls.showModal(),
		{ attrs: { "data-testid": "host-controls" } },
	);
	const reload = button(deps.t("Reload"), handlers.reload, {
		className: "sidebar-reload",
	});
	const exit = button(deps.t("New table"), handlers.createNew, {
		className: "sidebar-exit",
	});
	const pauseBots = button(deps.t("Pause bots"), () => {
		if (!botRunner) return;
		botRunner.pause();
		setBotsPaused(true);
		botStatus.textContent = deps.t("Bots paused.");
		render();
	});
	const resumeBots = button(deps.t("Resume bots"), () => {
		if (!botRunner) {
			setBotsPaused(false);
			void startHostBots();
			return;
		}
		botRunner.resume();
		setBotsPaused(false);
		botStatus.textContent = runningBotStatus();
		render();
	});
	const resetControls = el(
		"section",
		{ className: "room-controls", attrs: { "data-testid": "room-controls" } },
		// The build date and the language picker head the sidebar, so they scale with the room canvas.
		el(
			"div",
			{ className: "room-control-row room-header-controls" },
			languageControl(deps),
		),
		el(
			"div",
			{ className: "room-control-row room-primary-controls" },
			copyRoomLink,
			reload,
			exit,
		),
		el(
			"div",
			{ className: "room-control-row room-bot-controls" },
			openSettings,
			openHostControls,
			pauseBots,
			resumeBots,
		),
	);
	const resetStatus = el("p", { className: "note", attrs: { role: "status" } });
	const resetApprove = button(deps.t("Approve reset"), () => {
		if (resetRequestId !== undefined)
			submit(resetVotePayload(tableId, resetRequestId, true), (reason) => {
				actionError = deps.t("Reset approval not sent: {reason}", { reason });
			});
	});
	const resetReject = button(deps.t("Reject reset"), () => {
		if (resetRequestId !== undefined)
			submit(resetVotePayload(tableId, resetRequestId, false), (reason) => {
				actionError = deps.t("Reset decision not sent: {reason}", { reason });
			});
	});
	const resetCancel = button(deps.t("Cancel reset"), () => {
		if (resetRequestId !== undefined)
			submit(resetCancelPayload(tableId, resetRequestId), (reason) => {
				actionError = deps.t("Reset cancellation not sent: {reason}", {
					reason,
				});
			});
	});
	const resetDecision = el(
		"div",
		{ className: "reset-decision", attrs: { "data-testid": "reset-decision" } },
		resetStatus,
		resetApprove,
		resetReject,
		resetCancel,
	);
	resetControls.append(resetDecision);
	table.sidebar.prepend(resetControls);
	table.sidebarEnd.append(botStatus);

	// A storage warning stays visible on every screen, so it sits in the stage, not in the extras.
	const storageNotices =
		deps.storageProblem === undefined
			? []
			: [
					el(
						"p",
						{ className: "notice" },
						storageNotice(deps.storageProblem, deps.t),
					),
				];

	// The stage holds what a player needs during play; on a compact device it fills the screen.
	// While waiting (`data-waiting="true"`) the CSS hides the sidebar and the extras.
	const room = el(
		"section",
		{ className: "room" },
		el(
			"div",
			{ className: "stage" },
			you,
			banner,
			keepOpen,
			actionNote,
			...storageNotices,
			table.element,
		),
		audio.element,
		table.sidebar,
		// A diagnostic and test probe, not a player feature: the CSS keeps it off screen (`.room-extra`), and the
		// e2e tests use its chat and seat release controls through the DOM (tests/e2e/room.ts).
		el(
			"div",
			{ className: "room-extra" },
			el("h2", {}, deps.t("Players")),
			roster,
			rosterNote,
			allConnected,
			links,
			network.element,
			el("h2", {}, deps.t("Messages")),
			transcript,
			pending,
			form,
		),
	);
	// The device class sets the layout: a desktop shows the scaled Full HD room, a phone held upright the compact table,
	// and a phone held sideways the desktop table at the size of its screen, without videos.
	// The page root carries the layout too, so that only a desktop page becomes the fixed Full HD canvas.
	const setRoomLayout = (value: Layout): void => {
		const form = value === "compact" ? "compact" : "desktop";
		root.dataset.form = form;
		room.dataset.form = form;
		root.dataset.layout = value;
		room.dataset.layout = value;
		table.setForm(value);
	};
	setRoomLayout(deviceLayout);
	const updateRoomCanvasScale = (): void => {
		const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
		root.style.setProperty("--room-canvas-scale", String(scale));
	};
	updateRoomCanvasScale();
	window.addEventListener("resize", updateRoomCanvasScale);
	const pageIsVisible = (): boolean => document.visibilityState === "visible";
	const checkTurnAlert = (): void => {
		if (
			yourTurn &&
			currentTurnKey !== undefined &&
			!pageIsVisible() &&
			alertedTurn !== currentTurnKey
		) {
			alertedTurn = currentTurnKey;
			turnAlert.beep();
		}
	};
	const onPageStateChange = (): void => {
		if (document.visibilityState === "visible") wakeLock.pageShown();
		checkTurnAlert();
		render();
	};
	const deviceWatch = watchDeviceClass(
		window,
		() => readSettings(deps.browser),
		(value) => {
			setRoomLayout(value);
			call?.setForm(formOf(value));
		},
	);
	root.replaceChildren(room);
	root.append(settings.element, hostControls, players.element);
	if (camera) root.append(camera.element);
	if (initialBotSettings) void startHostBots();

	async function startHostBots(requiredSeat?: Seat): Promise<boolean> {
		if (botRunner) return true;
		if (botStarting) return false;
		const view = controller.view();
		const config = view.table?.config;
		if (!config) return false;
		const configured = view.roster?.bots ?? configuredBotSeats(config);
		if (configured.length === 0 && requiredSeat === undefined) return false;
		if (!view.hosting) {
			botStatus.textContent = deps.t(
				"Only the current host can run bots in this browser.",
			);
			return false;
		}
		botSettings ??= settingsFor(
			fallbackConfig ?? config,
			readSettings(deps.browser).playTimeMs,
		);
		botStarting = true;
		botAutoAttempted = true;
		const runner = new HostBotRunner(controller, botSettings, () => {
			for (const delegatedSeat of delegatedBotSeats) {
				delegatedBotSeats.delete(delegatedSeat);
				botRunner?.setSeatEnabled(delegatedSeat, false);
				void controller.setBotSeat(delegatedSeat, false);
			}
			botRunner = undefined;
			setBotsPaused(true);
			botStatus.textContent = deps.t(
				"The local bot failed. Resume bots to try again.",
			);
			render();
		});
		// A reload after a pause starts the runner paused, so it restores the bot seats without playing.
		if (botsPaused) runner.pause();
		if (
			!(await runner.start(requiredSeat === undefined ? [] : [requiredSeat]))
		) {
			runner.stop();
			botStarting = false;
			botStatus.textContent = deps.t(
				"Bots could not start. Check that this page is the ready host.",
			);
			return false;
		}
		botStarting = false;
		botRunner = runner;
		// Resume bots can run while the runner starts.
		if (!botsPaused) runner.resume();
		botStatus.textContent = botsPaused
			? deps.t("Bots paused.")
			: runningBotStatus();
		return true;
	}

	function renderCall(): void {
		const display: CallDisplay =
			call === undefined
				? { available: false, reason: support.available ? "" : support.reason }
				: {
						available: true,
						view: call.view,
						rejoin: memory?.rejoin,
						cameraAvailable: camera?.available,
					};
		table.renderCall(display, remoteCallPresence, hostInCall);
		audio.render(display.available ? display.view.remotes : []);
	}

	function renderBanner(
		shown: Banner | undefined,
		summary: SummaryInput,
	): void {
		const detail = connectionDetail(shown, summary);
		bannerDetail.hidden = detail === undefined;
		bannerDetail.textContent = detail ?? "";
		banner.hidden = shown === undefined;
		banner.dataset.kind = shown?.kind ?? "";
		bannerLine.textContent =
			shown === undefined ? "" : bannerText(shown, deps.t);
		const host = shown?.kind === "waiting-for-host" ? shown.button : undefined;
		becomeHost.hidden = host === undefined;
		becomeHost.disabled = host?.enabled !== true;
		bannerHint.hidden = host?.hint === undefined;
		bannerHint.textContent = host?.hint === undefined ? "" : deps.t(host.hint);
		retrySeat.hidden = shown?.kind !== "superseded";
		createNew.hidden = shown?.kind !== "expired";
	}

	function rosterItem(row: RosterRow): HTMLElement {
		const item = el(
			"li",
			{ attrs: { "data-seat": row.seat, "data-state": row.state } },
			el("span", { className: "dot", attrs: { "aria-hidden": "true" } }),
			el("span", { className: "label" }, row.label),
		);
		if (row.host) item.append(el("span", { className: "tag" }, deps.t("Host")));
		if (row.you) item.append(el("span", { className: "tag" }, deps.t("You")));
		item.append(
			el("span", { className: "state" }, deps.t(STATE_TEXT[row.state])),
		);
		if (!row.releasable) return item;
		if (confirming === row.seat) {
			item.append(
				button(deps.t("Confirm release"), () => release(row.seat), {
					attrs: { "data-testid": `confirm-release-${row.seat}` },
				}),
				button(deps.t("Cancel"), () => {
					confirming = undefined;
					render();
				}),
			);
		} else {
			item.append(
				button(
					deps.t("Release"),
					() => {
						confirming = row.seat;
						render();
					},
					{ attrs: { "data-testid": `release-${row.seat}` } },
				),
			);
		}
		return item;
	}

	function transcriptItem(line: TranscriptLine): HTMLElement {
		return el(
			"li",
			{ attrs: { "data-seq": String(line.seq) } },
			el("span", { className: "from" }, line.from),
			el("span", { className: "text" }, line.text),
			el(
				"span",
				{ className: "receipt" },
				deps.t("Received by {receivedBy} of {of}", {
					receivedBy: line.receivedBy,
					of: line.of,
				}),
			),
		);
	}

	function pendingItem(line: PendingLine): HTMLElement {
		const status =
			line.state === "sending"
				? deps.t("Sending")
				: line.state === "pending"
					? (line.reason ?? deps.t("Pending — waiting for the host"))
					: line.state === "undone"
						? deps.t(TEXT.undone)
						: deps.t("Not sent: {reason}", {
								reason: line.reason ?? deps.t("failed"),
							});
		return el(
			"li",
			{ attrs: { "data-state": line.state } },
			el("span", { className: "text" }, line.text),
			el("span", { className: "status" }, status),
		);
	}

	function render(): void {
		if (disposed) return;
		const view = controller.view();
		settings.refreshBidding();
		const botConfig = view.table?.config ?? fallbackConfig;
		if (!view.hosting) {
			botSeatOverrides.clear();
			botRestoreStarted = false;
			botRestorePending = false;
		} else if (!botRestoreStarted && fallbackConfig?.botSetup !== undefined) {
			botRestoreStarted = true;
			botRestorePending = true;
			void restoreBotSeats(fallbackConfig.botSetup.seats);
		}
		const activeBotSet = new Set(
			view.roster?.bots ?? (botConfig ? configuredBotSeats(botConfig) : []),
		);
		for (const [targetSeat, enabled] of botSeatOverrides) {
			if (enabled) activeBotSet.add(targetSeat);
			else activeBotSet.delete(targetSeat);
		}
		const activeBots = [...activeBotSet];
		if (
			view.roster !== null &&
			!botRestorePending &&
			(view.hosting || (view.hostSeat !== null && view.hostSeat !== seat)) &&
			(new URLSearchParams(location.search).get("bot_seats") !==
				SEATS.filter((targetSeat) => activeBotSet.has(targetSeat)).join(",") ||
				parseAutoplaySeats(location.search).join(",") !==
					SEATS.filter(
						(targetSeat) =>
							activeBotSet.has(targetSeat) &&
							view.roster?.autoplaySeats.includes(targetSeat),
					).join(","))
		)
			rememberBotSeats(activeBots);
		openHostControls.hidden = !view.hosting;
		if (!view.hosting && hostControls.open) hostControls.close();
		if (!view.hosting && players.element.open) players.element.close();
		if (view.hosting) showPlayerBuilds(view.roster?.bots ?? []);
		pauseBots.hidden =
			!view.hosting || activeBots.length === 0 || botsPaused || !botRunner;
		resumeBots.hidden =
			!view.hosting ||
			activeBots.length === 0 ||
			(!botsPaused && botRunner !== undefined);
		if (botRunner && !view.hosting) {
			botRunner.stop();
			botRunner = undefined;
			botStatus.textContent = deps.t("Host changed. Bots stopped.");
		}
		if (
			!botAutoAttempted &&
			!botRestorePending &&
			activeBots.length > 0 &&
			view.hosting
		)
			void startHostBots();
		const terminal = view.seat !== seat || TERMINAL.has(view.status);
		// A bot that the host chose plays the seat alone, and a bot sends no audio, so the page leaves the call. The
		// call stays off when the seat comes back.
		const botAlone = botPlays(view.roster, seat);
		const snapshot = controller.callSnapshot();
		call?.update(botAlone ? { ...snapshot, self: null } : snapshot);
		if (botAlone !== botHoldsSeat) {
			botHoldsSeat = botAlone;
			if (!botAlone) memory?.seatReturned();
		}
		renderBanner(bannerFor(view), {
			network: view.network,
			peers: view.peers,
			publicAddress: view.publicAddress,
			t: deps.t,
		});
		actionNote.textContent = actionError ?? "";
		actionNote.hidden = actionError === undefined;
		allConnected.hidden = !view.allConnected;
		rosterNote.textContent =
			releaseError ??
			(view.release?.ok === false
				? deps.t("Release failed: {reason}", {
						reason: releaseText(view.release.code, deps.t),
					})
				: "");
		network.render(
			networkLines({
				network: view.network,
				peers: view.peers,
				publicAddress: view.publicAddress,
				persistent: view.persistent,
				persisted,
				t: deps.t,
			}),
		);
		send.disabled = terminal;
		draft.disabled = terminal;
		// A new visitor learns the config from the host's lobby, or from the first copy of the table.
		const config = view.table?.config ?? view.lobby?.config ?? fallbackConfig;
		if (config === undefined) {
			root.dataset.screen = "table";
			root.dataset.waiting = "true";
			// A page that sleeps while it connects stops, and the host cannot reach it.
			wakeLock.update(true);
			keepOpen.hidden = false;
			you.hidden = false;
			you.textContent = deps.t(TEXT.connecting);
			send.textContent = deps.t(TEXT.send);
			sendNote.textContent = sendError ?? "";
			return;
		}
		const present = presentSeats(view.hostSeat, view.roster);
		copyRoomLink.hidden = false;
		const model = roomView({
			config,
			seat,
			terminal,
			ready: view.ready,
			held: heldSeats(view.table?.seats ?? view.roster?.seats ?? []),
			online: present,
			hostSeat: view.hostSeat,
			acked: Object.fromEntries(
				(view.roster?.seats ?? []).map((row) => [row.seat, row.acked]),
			),
			entries: controller.entries(),
			outbox: view.outbox,
			failures: view.failures,
			undone: view.undone,
		});
		// The table shows the viewer's seat in the layout, so no "You are …" line is needed here.
		you.hidden = true;
		const roomKey = JSON.stringify([model, confirming]);
		if (roomKey !== shownRoom) {
			shownRoom = roomKey;
			roster.replaceChildren(...model.roster.map(rosterItem));
			transcript.replaceChildren(...model.transcript.map(transcriptItem));
			pending.replaceChildren(...model.pending.map(pendingItem));
		}
		const state =
			view.table === null
				? undefined
				: (parseBridgeState(view.table.state, tableId) ?? null);
		const inCallSeats = callSeats(view.hostSeat, view.roster);
		remoteCallPresence = {};
		for (const targetSeat of SEATS) {
			const record = state?.media[targetSeat];
			const currentHolder = view.roster?.seats.find(
				(row) => row.seat === targetSeat,
			);
			if (
				record === undefined ||
				!record.prefs.inCall ||
				record.holder !== currentHolder?.holder ||
				!inCallSeats.has(targetSeat)
			) {
				continue;
			}
			remoteCallPresence[targetSeat] = {
				sendsAudio: record.prefs.send.audio,
				sendsVideo: record.prefs.send.video,
			};
		}
		hostInCall =
			!view.hosting &&
			view.hostSeat !== null &&
			view.hostSeat !== seat &&
			remoteCallPresence[view.hostSeat] !== undefined;
		// The other players see this player's bidding system below the name.
		const ownSystem = readSettings(deps.browser).pointSystem;
		if (
			state &&
			!terminal &&
			state.systems[seat] !== ownSystem &&
			sentSystem !== ownSystem
		) {
			sentSystem = ownSystem;
			submit(systemPayload(tableId, ownSystem), () => undefined);
		}
		renderCall();
		shownBoard = state?.board ?? null;
		const pendingReset = state?.reset ?? null;
		resetRequestId = pendingReset?.id;
		reset.disabled = terminal || pendingReset !== null;
		resetDecision.hidden = pendingReset === null;
		resetApprove.hidden =
			pendingReset === null ||
			pendingReset.requester === seat ||
			!pendingReset.required.includes(seat) ||
			pendingReset.approved.includes(seat);
		resetReject.hidden = resetApprove.hidden;
		resetCancel.hidden = pendingReset?.requester !== seat;
		if (pendingReset) {
			const requester = `${config.names[pendingReset.requester]} (${deps.t(pendingReset.requester)})`;
			const waitingFor = pendingReset.required
				.filter((player) => !pendingReset.approved.includes(player))
				.map((player) => `${config.names[player]} (${deps.t(player)})`);
			resetStatus.textContent =
				pendingReset.requester === seat
					? deps.t("Waiting for {players} to approve the reset.", {
							players: waitingFor.join(", "),
						})
					: deps.t("{requester} asks to reset the game.", { requester });
		}
		const completedBoard =
			state?.board &&
			(state.claimResult !== null ||
				boardStatus(state.board).phase === "complete")
				? state.board.number
				: undefined;
		if (completedBoard !== scoringBoard) {
			if (scoringTimer !== undefined) window.clearInterval(scoringTimer);
			scoringBoard = completedBoard;
			scoringStartedAt =
				completedBoard === undefined
					? undefined
					: (view.table?.lastActivityAt ?? Date.now());
			autoDealtBoard = undefined;
			scoringTimer =
				completedBoard === undefined
					? undefined
					: window.setInterval(render, 1000);
		}
		const scoringCountdown =
			scoringStartedAt === undefined
				? 10
				: Math.max(
						0,
						Math.ceil((scoringStartedAt + 10_000 - Date.now()) / 1000),
					);
		memory?.update({
			records: state?.media,
			outbox: view.outbox.map((item) => item.payload),
		});
		const tableModel = tableView({
			config,
			seat,
			state,
			terminal,
			present,
			roster: model.roster,
			bots: new Set(activeBots),
			hostSeat: view.hostSeat,
			scoringCountdown,
			outbox: view.outbox,
			failures: view.failures,
			undone: view.undone,
			roundTrips: view.roundTrips,
			t: deps.t,
		});
		shownModel = tableModel;
		table.setBotControls(view.hosting && !botRestorePending, activeBots);
		if (!view.hosting) delegatedBotSeats.clear();
		const rosterHost = JSON.stringify(view.roster?.auth ?? null);
		if (rosterHost !== playerAutoplayHost) {
			playerAutoplayHost = rosterHost;
			playerAutoplayWasEnabled = false;
			playerAutoplayConfirmedRoster = false;
			playerAutoplayAnswerRoster = undefined;
		}
		const rosterAutoplay = view.roster?.bots.includes(seat) ?? false;
		if (
			view.roster !== playerAutoplayAnswerRoster &&
			(rosterAutoplay || playerAutoplayWasEnabled)
		)
			playerAutoplayConfirmedRoster = true;
		if (playerAutoplayConfirmedRoster && !rosterAutoplay) {
			playerAutoplayConfirmedRoster = false;
			playerAutoplayWasEnabled = false;
			playerAutoplayStatus = deps.t("Autoplay stopped by the host.");
		}
		table.setPlayerAutoplay(
			!view.hosting && view.roster?.autoplay === true,
			playerAutoplayWasEnabled || rosterAutoplay,
			playerAutoplayPending,
			playerAutoplayStatus,
		);
		yourTurn = tableModel.yourTurn;
		currentTurnKey = yourTurn
			? `${tableModel.board}:${tableModel.at}:${seat}`
			: undefined;
		document.title = pageTitle(deps.t, {
			name: config.names[seat],
			seat,
			turn: yourTurn,
		});
		checkTurnAlert();
		// The lobby uses the table layout, so it looks like the game; only the sidebar is hidden while waiting.
		root.dataset.screen = "table";
		root.dataset.waiting = String(tableModel.phase === "waiting");
		const waiting =
			tableModel.phase === "loading" || tableModel.phase === "waiting";
		keepOpen.hidden = !waiting;
		// The lobby too: a host whose phone sleeps cannot answer the players who open the link, and a page that waits
		// for the host's table stops when it sleeps.
		wakeLock.update(
			waiting || tableModel.phase === "auction" || tableModel.phase === "play",
		);
		const tableKey = JSON.stringify(
			tableModel.scoring
				? {
						...tableModel,
						scoring: { ...tableModel.scoring, countdown: undefined },
					}
				: tableModel,
		);
		if (tableKey !== shownTable) {
			shownTable = tableKey;
			table.render(tableModel);
			if (tableModel.board !== 0) firstDealSent = false;
			const first = tableModel.nextBoard;
			if (view.hosting && first?.board === 1 && first.ready && !firstDealSent) {
				firstDealSent = true;
				dealBoard(1);
			}
		}
		table.setCountdown(tableModel.scoring?.countdown);
		const boardToDeal = autoDealBoard(
			view.hosting,
			tableModel.board,
			tableModel.scoring?.countdown,
			tableModel.nextBoard,
			autoDealtBoard,
		);
		if (boardToDeal !== undefined) {
			autoDealtBoard = boardToDeal;
			dealBoard(boardToDeal, () => {
				autoDealtBoard = undefined;
			});
		}
		send.textContent = deps.t(model.send.label);
		send.disabled = !model.send.enabled;
		sendNote.textContent =
			sendError ??
			(model.send.hint === undefined ? "" : deps.t(model.send.hint));
	}

	// A gesture lets the browser start remote audio and the voice box that its autoplay rule blocked.
	const onGesture = (): void => {
		audio.resume();
		voices.resume();
	};
	room.addEventListener("pointerdown", onGesture);
	room.addEventListener("keydown", onGesture);
	document.addEventListener("visibilitychange", onPageStateChange);
	const unsubscribe = controller.onChange(render);
	call?.onChange(renderCall);
	if (deps.storage.persistent) {
		void deps.persist().then((answer) => {
			persisted = answer;
			render();
		});
	}
	render();
	renderCall();

	return () => {
		disposed = true;
		botRunner?.stop();
		if (scoringTimer !== undefined) window.clearInterval(scoringTimer);
		deviceWatch.stop();
		window.removeEventListener("resize", updateRoomCanvasScale);
		root.style.removeProperty("--room-canvas-scale");
		delete root.dataset.form;
		delete root.dataset.layout;
		unsubscribe();
		unsubscribeCamera?.();
		camera?.dispose();
		document.removeEventListener("visibilitychange", onPageStateChange);
		room.removeEventListener("pointerdown", onGesture);
		room.removeEventListener("keydown", onGesture);
		controller.setReportSource(() => undefined);
		controller.setReloadHandler(() => undefined);
		wakeLock.update(false);
		memory?.stop();
		call?.dispose();
		audio.detach();
		voices.stop();
	};
}
