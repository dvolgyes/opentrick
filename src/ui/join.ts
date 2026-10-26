import type { HostBotSettings } from "../bot/host-runner";
import { updateUrl } from "../build";
import { bridgeModule } from "../game/bridge";
import { newCommandId } from "../ids";
import { randomNonce } from "../p2p/checks";
import {
	TableController,
	type TableIdentity,
	type TableStatus,
	type TableView,
	tableIdentity,
} from "../p2p/table";
import { unnamedPlayer } from "../players";
import { SEAT_NAMES, type Seat } from "../protocol";
import type { RoomSetup } from "./bookmark";
import type { AppDeps, Dispose, Navigation } from "./deps";
import { button, el } from "./dom";
import {
	chooseText,
	connectionSummary,
	type LobbyScreen,
	lobbyScreen,
	networkLines,
	seatText,
	storageNotice,
	TEXT,
} from "./model";
import { nameEntry } from "./name-entry";
import { networkPanel } from "./network";
import { pageTitle } from "./page-title";
import { showRoom } from "./room-view";
import { seatGrid } from "./seat-grid";
import { turnSound } from "./turn-sound";
import { screenWakeLock, WakeLockPolicy } from "./wake-lock";

/** A room in one of these states stays on the screen, read-only, after its seat is gone. */
const KEEP_ROOM: ReadonlySet<TableStatus> = new Set([
	"expired",
	"superseded",
	"incompatible",
]);

function message(...children: (Node | string)[]): HTMLElement {
	return el(
		"section",
		{ className: "message", attrs: { "data-testid": "message" } },
		...children,
	);
}

/**
 * A table link. Runs one table controller at a time: the lobby while this page holds no seat, and the room
 * screen while it holds one. `creator` is true only for the page load that has just created the table. A null
 * `seatHint` (selected_player=none) does not reopen the seat that this browser held: it takes a seat by itself only
 * when the host's lobby has one free seat that another browser held, and otherwise the person picks one in the lobby.
 */
export function showTable(
	root: HTMLElement,
	deps: AppDeps,
	key: string,
	creator: boolean,
	navigation: Navigation,
	seatHint?: Seat | null,
	bootstrap?: RoomSetup,
	autoCopy?: Promise<string>,
	hostBots?: HostBotSettings,
): Dispose {
	let disposed = false;
	const turnAlert = turnSound();
	const unlockTurnAlert = (): void => turnAlert.unlock();
	root.addEventListener("pointerdown", unlockTurnAlert);
	root.addEventListener("keydown", unlockTurnAlert);
	let identity: TableIdentity | undefined;
	let controller: TableController | undefined;
	let unsubscribe: (() => void) | undefined;
	/** True while a controller starts; the screen shows "Connecting" until it is ready. */
	let opening = false;
	let room: Dispose | undefined;
	let roomSeat: Seat | undefined;
	/** Why the last seat request of this page failed. */
	let notice: string | undefined;
	/** The lobby as last built: an equal lobby only updates its status line and the network panel. */
	let shown: string | undefined;
	/**
	 * True once this page has taken the last free seat, so a refusal does not repeat the take. Also true after another
	 * device took this page's seat: its player is probably at that device now, so the page takes no seat that frees later.
	 */
	let autoTook = false;
	let namePreferredSeat: Seat | undefined;
	let updating = false;

	const status = el("p", {
		attrs: { role: "status", "data-testid": "table-status" },
	});
	const summary = el("p", {
		className: "status",
		attrs: { "data-testid": "connection-summary" },
	});
	const keepOpen = el(
		"p",
		{ className: "note", attrs: { "data-testid": "keep-open" } },
		deps.t(TEXT.keepOpen),
	);
	const network = networkPanel(deps.t);
	// A phone that sleeps on the seat page stops the page, and the host cannot reach it. The room holds its own lock.
	const wakeLock = new WakeLockPolicy(screenWakeLock);

	const leaveRoom = (): void => {
		room?.();
		room = undefined;
		roomSeat = undefined;
	};

	const stopController = (): void => {
		unsubscribe?.();
		unsubscribe = undefined;
		controller?.stop();
		controller = undefined;
	};

	const showConnecting = (): void => {
		shown = undefined;
		document.title = pageTitle(deps.t);
		root.replaceChildren(message(el("p", {}, deps.t(TEXT.connecting))));
	};

	/** Tries to claim this seat again, if no active tab holds it and the host allows it. */
	const retryRoomSeat = (): void => {
		const seat = roomSeat;
		if (seat === undefined) return;
		leaveRoom();
		stopController();
		showConnecting();
		void open(false, async (table) => {
			const view = table.view();
			if (view.seat !== null) return;
			await take(seat);
		});
	};

	/** Another device holds this page's seat now: the page shows the seat page as a visitor, with the reason. */
	const leaveTakenSeat = (): void => {
		leaveRoom();
		stopController();
		seatHint = null;
		autoTook = true;
		navigation.forgetSeat();
		notice = seatText("taken", deps.t);
		showConnecting();
		void open(false);
	};

	async function open(
		asCreator: boolean,
		then?: (table: TableController) => Promise<void>,
	): Promise<void> {
		opening = true;
		identity ??= await tableIdentity(key, deps.browser);
		if (disposed) return;
		let preferred = seatHint;
		if (
			!asCreator &&
			typeof seatHint === "string" &&
			bootstrap &&
			unnamedPlayer(bootstrap.config.names[seatHint])
		) {
			const cached = await deps.storage.load(identity.tableId, seatHint);
			if (disposed) return;
			const owns =
				cached.ok &&
				cached.value?.table.seats.some(
					(row) => row.seat === seatHint && row.holder === identity?.holder,
				);
			if (!owns) {
				preferred = null;
				namePreferredSeat = seatHint;
			}
		}
		const table = new TableController({
			buildDate: deps.build.date,
			onNewerBuild: (date) => {
				if (updating || disposed) return;
				const target = updateUrl(deps.pageUrl(), deps.build.date, date);
				updating = true;
				leaveRoom();
				root.replaceChildren(
					message(el("p", {}, deps.t("Updating this page…"))),
				);
				void table.prepareReload().then(() => {
					if (disposed) return;
					if (target) navigation.update(date);
					else
						root.replaceChildren(
							message(
								el(
									"p",
									{},
									deps.t(
										"The website still serves an older build. Reload to try again.",
									),
								),
								button(deps.t("Reload"), () => navigation.reload()),
							),
						);
				});
			},
			identity,
			storage: deps.storage,
			locks: deps.locks,
			memory: deps.memory,
			module: bridgeModule,
			clock: deps.clock,
			every: (ms, run) => {
				const timer = setInterval(run, ms);
				return () => clearInterval(timer);
			},
			openMesh: deps.openMesh(identity.tableId, key),
			newId: newCommandId,
			nonce: randomNonce,
			creator: asCreator,
			preferredSeat: preferred,
			bootstrap,
		});
		controller = table;
		unsubscribe = table.onChange(render);
		await table.start();
		if (disposed || controller !== table) return;
		await then?.(table);
		if (disposed || controller !== table) return;
		opening = false;
		render();
	}

	async function take(seat: Seat, name?: string): Promise<void> {
		const table = controller;
		if (!table) return;
		const view = table.view();
		const row = view.lobby?.seats.find((item) => item.seat === seat);
		const needsName =
			row?.needsName ??
			unnamedPlayer(
				(view.lobby?.config ?? bootstrap?.config)?.names[seat] ?? "player",
			);
		if (needsName && name === undefined) {
			nameEntry(root, deps, seat, (value) => {
				const current = table
					.view()
					.lobby?.seats.find((item) => item.seat === seat);
				if (
					(row &&
						(row.gen !== current?.gen ||
							row.nameRevision !== current?.nameRevision)) ||
					(!row &&
						current &&
						(!current.needsName || current.nameRevision !== 0))
				) {
					notice = deps.t("The seat changed. Choose it again.");
					render();
					return;
				}
				void take(seat, value);
			});
			return;
		}
		notice = undefined;
		const result = await table.choose(seat, name);
		if (disposed || table !== controller) return;
		if (!result.ok) notice = chooseText(result.reason, deps.t);
		render();
	}

	function render(): void {
		const table = controller;
		if (disposed || updating || opening || !table) return;
		const view = table.view();
		if (
			view.seat === null &&
			view.seatError === "name_required" &&
			typeof seatHint === "string"
		)
			namePreferredSeat = seatHint;
		if (room !== undefined) {
			// The room renders itself. It goes only when the host refused or dropped the seat, or another device took it.
			if (view.status === "superseded" && view.supersededBy === "seat") {
				leaveTakenSeat();
				return;
			}
			if (view.seat === roomSeat || KEEP_ROOM.has(view.status)) return;
			leaveRoom();
		}
		wakeLock.update(view.seat === null);
		if (view.seat !== null) {
			navigation.rememberSeat(view.seat);
			document.title = pageTitle(deps.t, {
				name: view.table?.config.names[view.seat] ?? SEAT_NAMES[view.seat],
				seat: view.seat,
				turn: false,
			});
			shown = undefined;
			notice = undefined;
			roomSeat = view.seat;
			room = showRoom(
				root,
				deps,
				table,
				key,
				view.seat,
				{
					...navigation,
					retrySeat: retryRoomSeat,
					turnSound: turnAlert,
				},
				bootstrap?.config,
				autoCopy,
				hostBots,
			);
			return;
		}
		document.title = pageTitle(deps.t);
		const screen = lobbyScreen({
			status: view.status,
			supersededBy: view.supersededBy,
			election: view.election,
			lobby: view.lobby,
			heldElsewhere: view.heldElsewhere,
			setup: bootstrap,
			none: seatHint === null,
			t: deps.t,
		});
		// One claimable seat needs no choice, even when other same-browser tabs hold their own seats.
		if (
			typeof seatHint !== "string" &&
			!autoTook &&
			screen.kind === "lobby" &&
			screen.autoSeat !== undefined
		) {
			autoTook = true;
			void take(screen.autoSeat);
			return;
		}
		renderLobby(screen, view);
		if (
			namePreferredSeat !== undefined &&
			screen.kind === "lobby" &&
			screen.choices?.some(
				(choice) => choice.seat === namePreferredSeat && choice.free,
			)
		) {
			const preferred = namePreferredSeat;
			namePreferredSeat = undefined;
			void take(preferred);
		}
	}

	function renderLobby(screen: LobbyScreen, view: TableView): void {
		network.render(
			networkLines({
				network: view.network,
				peers: view.peers,
				publicAddress: view.publicAddress,
				persistent: view.persistent,
				persisted: undefined,
				t: deps.t,
			}),
		);
		if (screen.kind === "lobby") {
			status.textContent = screen.status ?? "";
			// The lobby has a status only while it waits for a connection.
			summary.hidden = screen.status === undefined;
			summary.textContent =
				screen.status === undefined
					? ""
					: connectionSummary({
							network: view.network,
							peers: view.peers,
							publicAddress: view.publicAddress,
							t: deps.t,
						});
		}
		const problem =
			notice ??
			(view.seatError === null ? undefined : seatText(view.seatError, deps.t));
		const signature = JSON.stringify([
			screen.kind === "lobby" ? { ...screen, status: undefined } : screen,
			problem,
		]);
		if (root.querySelector('[data-testid="name-entry"]')) return;
		if (signature === shown) return;
		shown = signature;
		root.replaceChildren(lobbyElement(screen, problem));
	}

	function lobbyElement(
		screen: LobbyScreen,
		problem: string | undefined,
	): HTMLElement {
		switch (screen.kind) {
			case "expired":
				return message(
					el("h1", {}, deps.t(TEXT.expired)),
					button(deps.t("Create new game"), navigation.createNew),
				);
			case "problem":
				return message(
					el("p", {}, screen.text),
					button(deps.t("Reload"), () => location.reload()),
					network.element,
				);
			case "lobby": {
				const parts: (Node | string)[] = [];
				if (screen.choices !== undefined)
					parts.push(el("h1", {}, deps.t("Choose your seat")));
				parts.push(status, summary, keepOpen);
				if (deps.storageProblem !== undefined)
					parts.push(
						el(
							"p",
							{ className: "notice" },
							storageNotice(deps.storageProblem, deps.t),
						),
					);
				if (problem !== undefined)
					parts.push(
						el("p", { className: "notice", attrs: { role: "alert" } }, problem),
					);
				if (screen.choices !== undefined) {
					parts.push(
						seatGrid(
							screen.choices.map((choice) => {
								const pick = button(
									choice.label,
									() => void take(choice.seat),
									{
										attrs: { "data-testid": `pick-${choice.seat}` },
									},
								);
								pick.disabled = !choice.free;
								return { seat: choice.seat, element: pick };
							}),
						),
					);
					if (!screen.choices.some((choice) => choice.free))
						parts.push(el("p", {}, deps.t("All seats are taken.")));
				}
				parts.push(network.element);
				return message(...parts);
			}
		}
	}

	// The election restarts its absence clock when the page comes back (plan §4.4 rule 5).
	const onVisible = (): void => {
		if (document.visibilityState !== "visible") return;
		wakeLock.pageShown();
		controller?.wake();
	};
	const onWake = (): void => controller?.wake();
	document.addEventListener("visibilitychange", onVisible);
	window.addEventListener("online", onWake);
	window.addEventListener("pageshow", onWake);

	/** A start link seats its host directly. A seat that another device holds leaves the lobby with a notice. */
	const claimHint = async (table: TableController): Promise<void> => {
		if (seatHint === undefined || seatHint === null) return;
		if (namePreferredSeat !== undefined) return;
		const view = table.view();
		if (view.seat !== null) return;
		const result = await table.choose(seatHint);
		if (!result.ok) notice = chooseText(result.reason, deps.t);
	};

	showConnecting();
	void open(creator, claimHint);

	return () => {
		disposed = true;
		wakeLock.update(false);
		document.title = pageTitle(deps.t);
		document.removeEventListener("visibilitychange", onVisible);
		window.removeEventListener("online", onWake);
		window.removeEventListener("pageshow", onWake);
		root.removeEventListener("pointerdown", unlockTurnAlert);
		root.removeEventListener("keydown", unlockTurnAlert);
		leaveRoom();
		stopController();
		turnAlert.dispose();
	};
}

/** A link that does not open a table: an old link, another version, or a damaged one. */
export function showLinkProblem(
	root: HTMLElement,
	navigation: Navigation,
	text: string,
	t: (message: string) => string = (message) => message,
): Dispose {
	root.replaceChildren(
		message(
			el("p", {}, text),
			button(t("Create new game"), navigation.createNew),
		),
	);
	return () => {};
}
