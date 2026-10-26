import { isChatCommand, isChatEvent } from "../game/bridge";
import { parseChatEvent } from "../game/chat";
import { englishTranslator as english, type Translate } from "../i18n";
import type { ElectionView, HostBlock } from "../p2p/election";
import { NOBODY_MS } from "../p2p/limits";
import type { MeshDiagnostics, RelayStatus } from "../p2p/mesh";
import type { OutboxItem, SubmitResult } from "../p2p/outbox";
import type { StorageCode } from "../p2p/storage";
import type { StunStatus } from "../p2p/stun-probe";
import type {
	ChooseResult,
	CommandFailure,
	PeerView,
	TableStatus,
} from "../p2p/table";
import type {
	Entry,
	Lobby,
	ReleaseCode,
	Roster,
	SeatCode,
	SeatHolder,
} from "../p2p/wire";
import { playerName, unnamedPlayer } from "../players";
import {
	isObject,
	isSeat,
	MAX_NAME_LENGTH,
	type RoomConfig,
	SEAT_NAMES,
	SEATS,
	type Seat,
	seatLabel,
} from "../protocol";

/** Pure view model of the table screens: the DOM layer only renders what these functions return. */

export const TEXT = {
	connecting: "Connecting",
	superseded: "This tab was superseded",
	expired: "The game has expired or is no longer available",
	send: "Send",
	sendHint: "Stored; sent when a host is connected",
	becomeHost: "Make me the host",
	undone: "Undone after a host change",
	keepOpen:
		"Keep this page open and in front until all four players are at the table. A phone stops a page in the background, and then the others cannot reach it.",
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Create form

export const DEFAULT_NAMES: Readonly<Record<Seat, string>> = {
	N: "",
	S: "",
	E: "",
	W: "",
};

export interface CreateFields {
	readonly names: Readonly<Record<Seat, string>>;
	/** The creator's own seat; its browser hosts first. */
	readonly seat: string;
}

export type CreateCheck =
	| { readonly ok: true; readonly config: RoomConfig; readonly seat: Seat }
	| { readonly ok: false; readonly errors: readonly string[] };

/** The room config rules, so the form explains a refusal before the table is written. */
export function checkCreateFields(
	fields: CreateFields,
	t: Translate = english,
): CreateCheck {
	const errors: string[] = [];
	const names: Partial<Record<Seat, string>> = {};
	for (const seat of SEATS) {
		const name = fields.names[seat].trim().normalize("NFC");
		const length = Array.from(name).length;
		if (seat === fields.seat && unnamedPlayer(name))
			errors.push(t("{seat}: enter a name.", { seat: SEAT_NAMES[seat] }));
		else if (length > MAX_NAME_LENGTH)
			errors.push(
				t("{seat}: use at most {max} characters.", {
					max: MAX_NAME_LENGTH,
					seat: SEAT_NAMES[seat],
				}),
			);
		else if (length > 0 && !playerName(name))
			errors.push(t("{seat}: enter a name.", { seat: SEAT_NAMES[seat] }));
		names[seat] = unnamedPlayer(name) ? "player" : (playerName(name) ?? name);
	}
	if (!isSeat(fields.seat)) errors.push(t("Choose your seat."));
	if (errors.length > 0 || !isSeat(fields.seat)) return { ok: false, errors };
	return {
		ok: true,
		config: {
			names: names as Record<Seat, string>,
			scoring: "duplicate",
		},
		seat: fields.seat,
	};
}

export const DEFAULT_CREATE_FIELDS: CreateFields = {
	names: DEFAULT_NAMES,
	seat: "S",
};

// ---------------------------------------------------------------------------------------------------------------
// Failure texts

/** A short explanation of a storage failure, for the person in front of the screen. */
export function storageText(code: StorageCode, t: Translate = english): string {
	switch (code) {
		case "expired":
			return t(TEXT.expired);
		case "conflict":
			return t(
				"Another tab changed the table at the same time. Reload the page.",
			);
		case "storage":
			return t("This browser could not save the table.");
	}
}

/** The notice on a page that keeps the table only in memory (plan §4.3). */
export function storageNotice(problem: string, t: Translate = english): string {
	return t(
		"This browser does not store data ({problem}). You can play, but you cannot become the host, and a reload loses this copy of the table.",
		{ problem },
	);
}

/** Why a message or an action was not stored for sending. */
export function submitText(
	result: Exclude<SubmitResult, { ok: true }>,
	t: Translate = english,
): string {
	return result.code === "full"
		? t("Too many messages are waiting. Wait until the host is connected.")
		: storageText(result.code, t);
}

/** Why the host did not accept a seat claim. */
export function seatText(code: SeatCode, t: Translate = english): string {
	switch (code) {
		case "name_required":
			return t("Enter your name to take this seat.");
		case "stale":
			return t("The seat changed. Choose it again.");
		case "taken":
			return t("Another player took this seat. Choose another one.");
		case "invalid":
			return t("This seat cannot be taken.");
		case "expired":
			return t(TEXT.expired);
		case "storage":
			return t("The host could not save the table. Try again.");
		case "not_host":
			return t("The host changed. Try again.");
	}
}

/** Why the host did not release a seat. */
export function releaseText(code: ReleaseCode, t: Translate = english): string {
	switch (code) {
		case "online":
			return t("The player is online again.");
		case "unseated":
			return t("Only a seated player can release a seat.");
		case "invalid":
			return t("This seat cannot be released.");
		case "storage":
			return t("The host could not save the table.");
		case "not_host":
			return t("The request did not reach the host. Try again.");
	}
}

const FAILURE_TEXT: Readonly<Record<CommandFailure["status"], string>> = {
	rejected: "rejected by the host",
	invalid: "the host could not read it",
	full: "the table is full",
};

const HOST_BLOCK_TEXT: Readonly<Record<HostBlock, string>> = {
	witness: "Another player must be online to confirm",
	seat: "Only a seated player can become the host",
	ineligible: "This client cannot host the table",
	storage: "This browser cannot store the table",
	limit: "This table cannot change its host again",
};

// ---------------------------------------------------------------------------------------------------------------
// Banner

export interface HostButtonView {
	readonly label: string;
	readonly enabled: boolean;
	readonly hint?: string;
}

export type Banner =
	| { readonly kind: "expired" }
	| { readonly kind: "superseded"; readonly by: "tab" | "seat" | null }
	| { readonly kind: "incompatible" }
	| { readonly kind: "full" }
	| { readonly kind: "connection-failed" }
	| { readonly kind: "host-unreachable" }
	| { readonly kind: "becoming-host"; readonly self: boolean }
	| {
			readonly kind: "waiting-for-host";
			readonly seconds: number;
			readonly button: HostButtonView | undefined;
	  }
	| { readonly kind: "nobody-here" }
	| { readonly kind: "connecting" };

export interface BannerInput {
	readonly status: TableStatus;
	readonly supersededBy: "tab" | "seat" | null;
	readonly election: ElectionView | null;
}

/**
 * One banner at a time (plan §4.9): expired > superseded > incompatible > full > connection failed > host
 * unreachable > becoming host > waiting for host > nobody here > connecting.
 */
export function bannerFor(input: BannerInput): Banner | undefined {
	const { status, election } = input;
	if (status === "expired") return { kind: "expired" };
	if (status === "superseded" || election?.phase === "superseded")
		return { kind: "superseded", by: input.supersededBy };
	if (status === "incompatible") return { kind: "incompatible" };
	if (status === "full") return { kind: "full" };
	if (status === "connection-failed") return { kind: "connection-failed" };
	if (status === "starting" || election === null) return { kind: "connecting" };
	switch (election.phase) {
		case "host-unreachable":
			return { kind: "host-unreachable" };
		case "becoming-host":
			return { kind: "becoming-host", self: election.self };
		case "waiting-for-host": {
			const { button } = election;
			return {
				kind: "waiting-for-host",
				seconds: Math.floor(election.absentMs / 1000),
				button:
					button === null
						? undefined
						: button.enabled
							? { label: TEXT.becomeHost, enabled: true }
							: {
									label: TEXT.becomeHost,
									enabled: false,
									hint: HOST_BLOCK_TEXT[button.reason],
								},
			};
		}
		case "nobody-here":
			return { kind: "nobody-here" };
		case "connecting":
			return { kind: "connecting" };
		default:
			return undefined;
	}
}

const SUPERSEDED_BY: Readonly<Record<"tab" | "seat", string>> = {
	tab: "another tab of this browser holds this seat now",
	seat: "another device holds this seat now",
};

/** The banner's sentence; a button may follow it. */
export function bannerText(banner: Banner, t: Translate = english): string {
	switch (banner.kind) {
		case "expired":
			return t(TEXT.expired);
		case "superseded":
			return banner.by === null
				? t(TEXT.superseded)
				: `${t(TEXT.superseded)}: ${t(SUPERSEDED_BY[banner.by])}`;
		case "incompatible":
			return t(
				"The other players use another version of the app. Reload the page.",
			);
		case "full":
			return t("This table has too many open pages");
		case "connection-failed":
			return t(
				"Connection failed: the other players were found, but no direct connection works. Try another network.",
			);
		case "host-unreachable":
			return t("The host is online, but this device cannot reach it");
		case "becoming-host":
			return t(banner.self ? "Becoming host…" : "A new host is taking over…");
		case "waiting-for-host":
			return t("Waiting for the host ({seconds} s)", {
				seconds: banner.seconds,
			});
		case "nobody-here":
			return t("Nobody is at this table right now. Keep this page open");
		case "connecting":
			return t(TEXT.connecting);
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Lobby

/** Why this page could not take a seat. */
export function chooseText(
	reason: Exclude<ChooseResult, { ok: true }>["reason"],
	t: Translate = english,
): string {
	switch (reason) {
		case "seated":
			return t("This page already holds a seat.");
		case "held-elsewhere":
			return t("Another tab of this browser holds this seat.");
		case "closed":
			return t("The table is closed. Reload the page.");
		case "refused":
			return t("Another tab of this browser is taking this seat. Try again.");
		default:
			return storageText(reason, t);
	}
}

export interface LobbyChoice {
	readonly seat: Seat;
	/** The seat and its player; a seat that this page cannot take also says why, for example "(host)". */
	readonly label: string;
	/** This page can take the seat. The page shows the other seats too, but disabled. */
	readonly free: boolean;
}

export type LobbyScreen =
	| { readonly kind: "expired" }
	| { readonly kind: "problem"; readonly text: string }
	| {
			readonly kind: "lobby";
			readonly status: string | undefined;
			/**
			 * All four seats; undefined until the host's lobby or the setup link names the players. The setup link's seats
			 * are free only when the page finds no host.
			 */
			readonly choices: readonly LobbyChoice[] | undefined;
			/** The only free seat, which the page takes without a choice. */
			readonly autoSeat: Seat | undefined;
	  };

export interface LobbyInput extends BannerInput {
	readonly lobby: Lobby | null;
	readonly heldElsewhere: readonly Seat[];
	readonly setup?: { readonly config: RoomConfig };
	/**
	 * The link has selected_player=none. The page then takes the only free seat only when the host's lobby lists it,
	 * and not when it is the seat of this browser's holder (ADR 0005).
	 */
	readonly none?: boolean;
	readonly t?: Translate;
}

/** The screen of a page without a seat. The lobby lists all four seats, and marks the seats this page can take. */
export function lobbyScreen(input: LobbyInput): LobbyScreen {
	const banner = bannerFor(input);
	const t = input.t ?? english;
	switch (banner?.kind) {
		case "expired":
			return { kind: "expired" };
		case "superseded":
		case "incompatible":
		case "full":
		case "connection-failed":
			return { kind: "problem", text: bannerText(banner, t) };
	}
	const { lobby } = input;
	const elsewhere = new Set(input.heldElsewhere);
	const setupConfig = input.setup?.config;
	// The link only finds the host, and the host's lobby says which seats are free. The page offers the link's seats
	// only when it finds no host, so that it can start the table again from the link (ADR 0005).
	const hostless =
		banner?.kind === "nobody-here" ||
		(banner?.kind === "waiting-for-host" && banner.seconds * 1000 >= NOBODY_MS);
	const choice = (
		config: RoomConfig,
		seat: Seat,
		taken: SeatMark | undefined,
	): LobbyChoice => {
		const label = seatLabel(config, seat);
		return taken === undefined
			? { seat, label, free: true }
			: { seat, label: markedSeat(taken, label, t), free: false };
	};
	const choices =
		lobby !== null
			? lobby.seats.map((row) =>
					choice(
						lobby.config,
						row.seat,
						row.host === true && !row.available
							? "host"
							: row.bot === true && !row.available
								? "bot"
								: elsewhere.has(row.seat)
									? "elsewhere"
									: row.available
										? undefined
										: "taken",
					),
				)
			: setupConfig !== undefined
				? SEATS.map((seat) =>
						choice(
							setupConfig,
							seat,
							elsewhere.has(seat)
								? "elsewhere"
								: hostless
									? undefined
									: "waiting",
						),
					)
				: undefined;
	const free = choices?.filter((item) => item.free) ?? [];
	const only = free.length === 1 ? free[0]?.seat : undefined;
	const held =
		lobby?.seats.some((row) => row.seat === only && row.mine) ?? true;
	return {
		kind: "lobby",
		status: banner === undefined ? undefined : bannerText(banner, t),
		choices,
		autoSeat: input.none === true && held ? undefined : only,
	};
}

/** Why the page cannot take a seat. */
type SeatMark = "host" | "bot" | "elsewhere" | "taken" | "waiting";

function markedSeat(mark: SeatMark, seat: string, t: Translate): string {
	switch (mark) {
		case "host":
			return t("{seat} (host)", { seat });
		case "bot":
			return t("{seat} (bot)", { seat });
		case "elsewhere":
			return t("{seat} (in another tab)", { seat });
		case "taken":
			return t("{seat} (taken)", { seat });
		case "waiting":
			return t("{seat} (waiting for the host)", { seat });
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Network panel

export interface NetworkInput {
	readonly network: MeshDiagnostics | null;
	readonly peers: readonly PeerView[];
	readonly publicAddress: boolean;
	readonly persistent: boolean;
	/** The browser's answer to the persistence request; undefined before it answers. */
	readonly persisted: boolean | undefined;
	readonly t?: Translate;
}

export interface NetworkLine {
	readonly label: string;
	readonly value: string;
}

/**
 * Counts, yes-or-no facts, the kinds of this page's local candidates (type, protocol and address family) and the
 * host names of the configured trackers, Nostr relays, MQTT brokers and STUN servers only: never an address, a
 * candidate or a session description.
 */
export function networkLines(input: NetworkInput): NetworkLine[] {
	const { network } = input;
	const t = input.t ?? english;
	const checked: string[] = [];
	for (const peer of input.peers) {
		if (peer.seat !== null && peer.check?.state === "ready")
			checked.push(
				`${SEAT_NAMES[peer.seat]} (${Math.round(peer.check.rttMs)} ms)`,
			);
	}
	// The panel starts with the summary's lines, so the WebRTC check stays where the summary showed it.
	const [trackers, nostr, mqtt, webRtc, direct, publicAddress] = summaryLines(
		input,
		t,
	);
	return [
		trackers,
		nostr,
		mqtt,
		webRtc,
		...(network?.relays ?? []).map((relay) => relayLine(relay, t)),
		...(network?.stun ?? []).map((stun) => ({
			label: t("STUN {host}", { host: serverName(stun.url) }),
			value: t(STUN_STATE[stun.state]),
		})),
		candidatesLine(network?.webRtc ?? null, t),
		direct,
		{
			label: t("Players checked"),
			value: checked.length === 0 ? t("none") : checked.join(", "),
		},
		{
			label: t("Pages not reachable directly"),
			value: String(network?.unreachable ?? 0),
		},
		{
			label: t("Link repair rooms"),
			value: network ? repairLine(network, t) : t("none"),
		},
		{
			label: t("Rejoins with no links"),
			value: String(network?.rejoins ?? 0),
		},
		publicAddress,
		{
			label: t("Ignored wrong-key attempts"),
			value: String(network?.wrongKey ?? 0),
		},
		{ label: t("Storage"), value: storageLine(input, t) },
	];
}

export type SummaryInput = Pick<
	NetworkInput,
	"network" | "peers" | "publicAddress" | "t"
>;

/** One line for a page that waits for a host: how far its signalling and its direct connections got. */
export function connectionSummary(input: SummaryInput): string {
	return summaryLines(input, input.t ?? english)
		.map((line) => `${line.label}: ${line.value}`)
		.join(" · ");
}

/** The summary under a banner that waits for a connection; undefined under the other banners. */
export function connectionDetail(
	banner: Banner | undefined,
	input: SummaryInput,
): string | undefined {
	switch (banner?.kind) {
		case "connecting":
		case "waiting-for-host":
		case "host-unreachable":
		case "nobody-here":
		case "connection-failed":
		case "becoming-host":
			return connectionSummary(input);
		default:
			return undefined;
	}
}

function summaryLines(
	input: SummaryInput,
	t: Translate,
): readonly [
	NetworkLine,
	NetworkLine,
	NetworkLine,
	NetworkLine,
	NetworkLine,
	NetworkLine,
] {
	const { network } = input;
	return [
		{
			label: t("Trackers reachable"),
			value: network
				? t("{open} of {total}", {
						open: network.trackersOpen,
						total: network.trackers,
					})
				: t("not started"),
		},
		{
			label: t("Nostr relays reachable"),
			value: network
				? t("{open} of {total}", {
						open: network.nostrOpen,
						total: network.nostrRelays,
					})
				: t("not started"),
		},
		{
			label: t("MQTT brokers reachable"),
			value: network
				? t("{open} of {total}", {
						open: network.mqttOpen,
						total: network.mqttBrokers,
					})
				: t("not started"),
		},
		{
			label: t("WebRTC in this browser"),
			value: channelValue(network?.webRtc ?? null, t),
		},
		{ label: t("Direct connections"), value: String(input.peers.length) },
		{
			label: t("Public address found"),
			value: publicAddressFound(input) ? t("yes") : t("no"),
		},
	];
}

/**
 * A link's server-reflexive candidate, a STUN server's answer, or a server-reflexive candidate of the WebRTC check:
 * each shows that STUN gave this page a public address, and the last two need no link.
 */
function publicAddressFound({ network, publicAddress }: SummaryInput): boolean {
	return (
		publicAddress ||
		(network?.stun ?? []).some((stun) => stun.state === "answered") ||
		(network?.webRtc?.kind === "checked" &&
			network.webRtc.candidates.some((label) => label.startsWith("srflx ")))
	);
}

/** The kinds of local candidates of the WebRTC check inside the page. */
function candidatesLine(
	report: MeshDiagnostics["webRtc"],
	t: Translate,
): NetworkLine {
	const checked = report?.kind === "checked" ? report : undefined;
	return {
		label: t("Local candidates"),
		value:
			checked === undefined
				? t("checking")
				: checked.candidates.length === 0
					? t("none")
					: checked.candidates.join(", "),
	};
}

/** Whether the data channel of the WebRTC check carried its message, or that the browser has no WebRTC. */
function channelValue(report: MeshDiagnostics["webRtc"], t: Translate): string {
	if (report === null) return t("checking");
	if (report.kind === "missing") return t("missing");
	return report.channel === "open" ? t("works") : t("failed");
}

const STUN_STATE: Readonly<Record<StunStatus["state"], string>> = {
	checking: "checking",
	answered: "answered",
	"no-answer": "no answer",
};

function relayLine(relay: RelayStatus, t: Translate): NetworkLine {
	const host = serverName(relay.url);
	const heard =
		relay.heardAgoMs === undefined
			? t("nothing heard yet")
			: t("heard {seconds} s ago", {
					seconds: Math.round(relay.heardAgoMs / 1000),
				});
	return {
		label: {
			tracker: t("Tracker {host}", { host }),
			nostr: t("Nostr relay {host}", { host }),
			mqtt: t("MQTT broker {host}", { host }),
		}[relay.kind],
		value: relay.open ? `${t("open")}, ${heard}` : t("closed"),
	};
}

/** The host of a `wss:` URL, or the host and port after the scheme of a `stun:` URL. */
function serverName(url: string): string {
	if (!URL.canParse(url)) return url;
	const parsed = new URL(url);
	return parsed.host !== "" ? parsed.host : parsed.pathname;
}

function repairLine(network: MeshDiagnostics, t: Translate): string {
	const late =
		network.unattached > 0
			? ` (${network.unattached} ${t("after connecting")})`
			: "";
	return `${network.pairRooms} ${t("open")}, ${network.repaired} ${t("repaired")}, ${network.pairTimeouts} ${t("timed out")}${late}`;
}

function storageLine(input: NetworkInput, t: Translate): string {
	if (!input.persistent) return t("memory only: a reload loses this copy");
	if (input.persisted === true) return t("kept by the browser");
	if (input.persisted === false) return t("stored; the browser may clear it");
	return t("stored in this browser");
}

// ---------------------------------------------------------------------------------------------------------------
// Room view

export interface RosterRow {
	readonly seat: Seat;
	readonly label: string;
	readonly host: boolean;
	readonly you: boolean;
	readonly state: "online" | "offline" | "free";
	/** Another player holds this seat and is offline, so the viewer may release it (D2). */
	readonly releasable: boolean;
}

export interface TranscriptLine {
	readonly seq: number;
	readonly from: string;
	readonly text: string;
	/** Seats other than the sender that acknowledged this event. */
	readonly receivedBy: number;
	readonly of: number;
}

export type PendingState = "sending" | "pending" | "not-sent" | "undone";

export interface PendingLine {
	readonly id: string;
	readonly text: string;
	readonly state: PendingState;
	readonly reason?: string;
}

export interface SendState {
	readonly label: string;
	readonly enabled: boolean;
	readonly hint?: string;
}

export interface RoomView {
	readonly roster: readonly RosterRow[];
	readonly transcript: readonly TranscriptLine[];
	readonly pending: readonly PendingLine[];
	readonly send: SendState;
}

export interface RoomViewInput {
	readonly config: RoomConfig;
	readonly seat: Seat;
	/** The tab can no longer act (superseded, expired or stopped). */
	readonly terminal: boolean;
	/** Own commands reach a host now. */
	readonly ready: boolean;
	/** The seats that a player holds in the replica. */
	readonly held: ReadonlySet<Seat>;
	/** The host's seat and the seats whose peer is connected to the host. */
	readonly online: ReadonlySet<Seat>;
	readonly hostSeat: Seat | null;
	/** The latest revision that each seat acknowledged. */
	readonly acked: Readonly<Partial<Record<Seat, number>>>;
	/** The replicated log, oldest first. */
	readonly entries: readonly Entry[];
	readonly outbox: readonly OutboxItem[];
	readonly failures: readonly CommandFailure[];
	readonly undone: readonly Entry[];
}

/** The seats that a player holds. */
export function heldSeats(rows: readonly SeatHolder[]): ReadonlySet<Seat> {
	return new Set(
		rows.filter((row) => row.holder !== null).map((row) => row.seat),
	);
}

/**
 * The host's seat, and the seats whose peer the roster binds at the seat's current generation (plan §12 R4).
 * The host decides; this copy only explains why an action waits.
 */
export function presentSeats(
	hostSeat: Seat | null,
	roster: Roster | null,
): ReadonlySet<Seat> {
	const present = new Set<Seat>();
	if (hostSeat !== null) present.add(hostSeat);
	for (const binding of roster?.peers ?? []) {
		const row = roster?.seats.find((item) => item.seat === binding.seat);
		if (row?.gen === binding.gen) present.add(binding.seat);
	}
	for (const seat of roster?.bots ?? []) present.add(seat);
	return present;
}

/** A bot plays the seat alone: the host chose it, so the seat's player did not ask for autoplay. */
export function botPlays(roster: Roster | null, seat: Seat): boolean {
	return (
		roster?.bots.includes(seat) === true && !roster.autoplaySeats.includes(seat)
	);
}

/** The seats whose own page is at the table and plays it, so that page can be in the call. A bot sends no audio. */
export function callSeats(
	hostSeat: Seat | null,
	roster: Roster | null,
): ReadonlySet<Seat> {
	const seats = new Set<Seat>();
	if (hostSeat !== null) seats.add(hostSeat);
	for (const binding of roster?.peers ?? []) {
		const row = roster?.seats.find((item) => item.seat === binding.seat);
		if (row?.gen === binding.gen) seats.add(binding.seat);
	}
	for (const seat of SEATS) if (botPlays(roster, seat)) seats.delete(seat);
	return seats;
}

export function roomView(input: RoomViewInput): RoomView {
	return {
		roster: SEATS.map((rowSeat) => rosterRow(input, rowSeat)),
		transcript: transcriptLines(input),
		pending: pendingLines(input),
		send: sendState(input),
	};
}

function rosterRow(input: RoomViewInput, seat: Seat): RosterRow {
	const held = input.held.has(seat);
	const online = input.online.has(seat);
	return {
		seat,
		label: `${SEAT_NAMES[seat]} — ${input.config.names[seat]}`,
		host: seat === input.hostSeat,
		you: seat === input.seat,
		state: online ? "online" : held ? "offline" : "free",
		releasable: !input.terminal && seat !== input.seat && held && !online,
	};
}

/** Chat messages only: deals, calls and plays show on the table, and the call status in the call panel. */
function transcriptLines(input: RoomViewInput): TranscriptLine[] {
	const lines: TranscriptLine[] = [];
	for (const entry of input.entries) {
		if (entry.kind !== "cmd" || !isChatEvent(entry.event)) continue;
		const others = SEATS.filter((seat) => seat !== entry.seat);
		const receivedBy = others.filter(
			(seat) => (input.acked[seat] ?? 0) >= entry.seq,
		).length;
		const event = parseChatEvent(entry.event);
		lines.push({
			seq: entry.seq,
			from: `${SEAT_NAMES[entry.seat]} — ${event?.fromName ?? input.config.names[entry.seat]}`,
			text: event?.text ?? "(unreadable message)",
			receivedBy,
			of: others.length,
		});
	}
	return lines;
}

function payloadText(payload: unknown): string {
	return isObject(payload) && typeof payload.text === "string"
		? payload.text
		: "";
}

/** Shared by the room and the table: one own command that is not in the log. */
export interface OwnCommandLine<State extends string> {
	readonly id: string;
	readonly payload: unknown;
	readonly state: State;
	readonly reason?: string;
}

/**
 * This seat's commands that are not in the log: undone by a host change, refused by the host, and waiting in
 * the outbox, in that order.
 */
export function ownCommands(
	input: Pick<RoomViewInput, "outbox" | "failures" | "undone">,
): OwnCommandLine<PendingState>[] {
	const lines: OwnCommandLine<PendingState>[] = [];
	for (const entry of input.undone) {
		if (entry.kind === "cmd")
			lines.push({ id: entry.id, payload: entry.payload, state: "undone" });
	}
	for (const failure of input.failures) {
		lines.push({
			id: failure.id,
			payload: failure.payload,
			state: "not-sent",
			reason: failure.reason ?? FAILURE_TEXT[failure.status],
		});
	}
	for (const item of input.outbox) {
		const { id, payload } = item;
		if (item.waiting !== undefined)
			lines.push({ id, payload, state: "pending", reason: item.waiting });
		else
			lines.push({
				id,
				payload,
				state: item.state === "queued" ? "pending" : "sending",
			});
	}
	return lines;
}

function pendingLines(input: RoomViewInput): PendingLine[] {
	return ownCommands(input)
		.filter((line) => isChatCommand(line.payload))
		.map((line) => ({
			id: line.id,
			text: payloadText(line.payload),
			state: line.state,
			...(line.reason === undefined ? {} : { reason: line.reason }),
		}));
}

/** A seated tab may always send: the outbox stores the message until a host is connected. */
function sendState(input: RoomViewInput): SendState {
	if (input.terminal) return { label: TEXT.send, enabled: false };
	return input.ready
		? { label: TEXT.send, enabled: true }
		: { label: TEXT.send, enabled: true, hint: TEXT.sendHint };
}

/** Initial text of the send field. */
export function draftFor(seat: Seat): string {
	return `Connection test from ${SEAT_NAMES[seat]}`;
}
