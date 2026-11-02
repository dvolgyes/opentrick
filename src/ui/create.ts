import type { HostBotSettings } from "../bot/host-runner";
import { botTiming } from "../bot/timing";
import type { OpenSeats } from "../community/formation";
import { bridgeModule } from "../game/bridge";
import { newCommandId } from "../ids";
import { newTableKey } from "../p2p/link";
import { CANNOT_STORE, createTable, tableIdentity } from "../p2p/table";
import {
	DEFAULT_BOT_SETUP,
	type LocalBidder,
	parseBotSetup,
	type RoomConfig,
	SEAT_NAMES,
	SEATS,
	type Seat,
} from "../protocol";
import type { Bookmark } from "./bookmark";
import type { AppDeps, Dispose } from "./deps";
import { discoveryCount } from "./discovery-count";
import { button, el } from "./dom";
import { languageControl } from "./language-control";
import {
	BIDDER_NAMES,
	BOT_NAME,
	type CreateFields,
	checkCreateFields,
	DEFAULT_CREATE_FIELDS,
	isBotName,
	storageText,
} from "./model";
import { readPersonalName, savePersonalName } from "./personal-name";
import { seatGrid } from "./seat-grid";
import { readSettings } from "./settings";
import { type EntryPage, sitePath } from "./site-path";

/** A solo game: the creator hosts at South against three bots. */
const SOLO_HOST: Seat = "S";

/** One way to start a game: its button and the list that explains a refusal. */
interface CreateTarget {
	readonly submit: HTMLButtonElement | HTMLAnchorElement;
	readonly errors: HTMLElement;
	readonly label: string;
}

export interface CommunityCreation {
	readonly bidder: LocalBidder;
	readonly name: string;
	readonly seat: Seat;
	readonly names: Readonly<Partial<Record<Seat, string>>>;
	readonly open: OpenSeats;
}

/**
 * The create screen, prefilled from a bookmark (names and the creator's seat). Calls `onCreated` with the table key,
 * its config and the creator's seat only after the table is stored in this browser.
 */
export function showCreate(
	root: HTMLElement,
	deps: AppDeps,
	prefill: Bookmark,
	onCreated: (
		key: string,
		config: RoomConfig,
		seat: Seat,
		hostBots?: HostBotSettings,
		entry?: "solo" | "create",
	) => void,
	onCommunity: (setup: CommunityCreation, entry?: "join" | "create") => void,
	entry: EntryPage | "home" = "home",
): Dispose {
	let disposed = false;
	const discovery = discoveryCount(deps);
	const pathname = new URL(deps.pageUrl()).pathname;
	const nameFields = {} as Record<Seat, HTMLInputElement>;
	const meChoices = {} as Record<Seat, HTMLInputElement>;
	const typeChoices = {} as Record<Seat, HTMLSelectElement>;
	const host = prefill.host ?? DEFAULT_CREATE_FIELDS.seat;
	// A bookmark from before the host rule can name the creator's seat a bot; the creator stays human.
	const prefillBots = (prefill.botSetup ?? DEFAULT_BOT_SETUP).seats.filter(
		(seat) => seat !== host,
	);
	const rows = SEATS.map((seat) => {
		const name = el("input", {
			attrs: {
				type: "text",
				name: `name-${seat}`,
				autocomplete: "off",
				placeholder: deps.t("player"),
				"aria-label": `${deps.t(SEAT_NAMES[seat])} ${deps.t("Name").toLowerCase()}`,
			},
		});
		name.value = prefillBots.includes(seat)
			? ""
			: (prefill.names[seat] ??
				(seat === host
					? readPersonalName(deps.browser)
					: DEFAULT_CREATE_FIELDS.names[seat]));
		nameFields[seat] = name;
		const me = el("input", {
			attrs: { type: "radio", name: "me", value: seat },
		});
		const type = el(
			"select",
			{
				attrs: {
					name: `type-${seat}`,
					"aria-label": `${deps.t(SEAT_NAMES[seat])}: ${deps.t("Seat type")}`,
				},
			},
			...(
				[
					["friend", "Invited friend"],
					["bot", "Bot"],
					["online", "Online player"],
					["both", "Online, then bot"],
				] as const
			).map(([value, label]) =>
				el("option", { attrs: { value } }, deps.t(label)),
			),
		);
		me.checked = seat === host;
		type.value = prefillBots.includes(seat) ? "bot" : "friend";
		meChoices[seat] = me;
		typeChoices[seat] = type;
		me.setAttribute(
			"aria-label",
			`${deps.t(SEAT_NAMES[seat])} ${deps.t("Host")}`,
		);
		return {
			seat,
			element: el(
				"section",
				{},
				el("h2", {}, deps.t(SEAT_NAMES[seat])),
				el(
					"p",
					{ className: "seat-partnership" },
					deps.t(
						seat === "N" || seat === "S"
							? "North–South partnership"
							: "East–West partnership",
					),
				),
				name,
				el(
					"div",
					{ className: "seat-roles" },
					el("label", {}, me, ` ${deps.t("Host")}`),
					type,
				),
			),
		};
	});

	// A named seat is reserved for a friend, and the host is always human.
	const syncChoices = (): void => {
		for (const seat of SEATS) {
			const named =
				nameFields[seat].value.trim().length > 0 &&
				!isBotName(nameFields[seat].value);
			if (named || meChoices[seat].checked) {
				typeChoices[seat].value = "friend";
			}
			typeChoices[seat].disabled = meChoices[seat].checked;
		}
	};
	for (const seat of SEATS) {
		nameFields[seat].addEventListener("input", () => {
			syncChoices();
		});
		typeChoices[seat].addEventListener("change", () => {
			if (typeChoices[seat].value !== "friend") nameFields[seat].value = "";
			syncChoices();
		});
		meChoices[seat].addEventListener("change", syncChoices);
	}
	syncChoices();
	const presets = el(
		"div",
		{
			className: "seat-presets",
			attrs: { "aria-label": deps.t("Fill unnamed seats") },
		},
		...(["Bots", "Online players", "Online, then bot"] as const).map((label) =>
			button(
				deps.t(label),
				() => {
					for (const seat of SEATS) {
						if (
							meChoices[seat].checked ||
							(nameFields[seat].value.trim() &&
								!isBotName(nameFields[seat].value))
						)
							continue;
						nameFields[seat].value = "";
						typeChoices[seat].value =
							label === "Bots"
								? "bot"
								: label === "Online players"
									? "online"
									: "both";
					}
					syncChoices();
				},
				{
					attrs: {
						"data-testid": `preset-${label === "Bots" ? "bots" : label === "Online, then bot" ? "both" : "online"}`,
					},
				},
			),
		),
	);

	const scoring = el(
		"select",
		{ attrs: { name: "scoring" } },
		el("option", { attrs: { value: "duplicate" } }, deps.t("Duplicate")),
	);
	const setup = prefill.botSetup ?? {
		...DEFAULT_BOT_SETUP,
		bidder: readSettings(deps.browser).bidder,
	};
	const bidder = el(
		"select",
		{ attrs: { name: "bot-bidder", "aria-label": deps.t("Bidding bot") } },
		...Object.entries(BIDDER_NAMES).map(([value, label]) =>
			el("option", { attrs: { value } }, deps.t(label)),
		),
	);
	bidder.value = setup.bidder;

	const errorList = (testId: string): HTMLElement =>
		el("ul", {
			className: "errors",
			attrs: { role: "alert", "data-testid": testId },
		});
	const solo = {
		submit: el(
			"a",
			{
				className: "button",
				attrs: {
					href: sitePath(pathname, "solo"),
					"data-testid": "create-solo",
				},
			},
			deps.t("Play with bots"),
		),
		errors: errorList("solo-errors"),
		label: deps.t("Play with bots"),
	} satisfies CreateTarget;
	const multiplayer: CreateTarget = {
		submit: el(
			"button",
			{ attrs: { type: "submit", "data-testid": "create" } },
			deps.t("Create game"),
		),
		errors: errorList("errors"),
		label: deps.t("Create game"),
	};
	const targets = [solo, multiplayer];

	const defaultSoloName = deps.t("Human");
	const soloName = el("input", {
		attrs: {
			type: "text",
			id: "solo-name",
			name: "solo-name",
			autocomplete: "off",
		},
	});
	soloName.value = readPersonalName(deps.browser) || defaultSoloName;
	let previousPersonalName = soloName.value;
	soloName.addEventListener("input", () => {
		const seat = SEATS.find((item) => meChoices[item].checked);
		if (
			seat &&
			(!nameFields[seat].value ||
				nameFields[seat].value === previousPersonalName)
		)
			nameFields[seat].value = soloName.value;
		previousPersonalName = soloName.value;
	});
	const online = el(
		"a",
		{
			className: "button",
			attrs: {
				href: sitePath(pathname, "join"),
				"data-testid": "join-online",
			},
		},
		deps.t("Find online players"),
	);
	const follow = (link: HTMLAnchorElement, run: () => void): void => {
		link.addEventListener("click", (event) => {
			if (link.getAttribute("aria-disabled") === "true") {
				event.preventDefault();
				return;
			}
			if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
				if (soloName.value.trim() !== defaultSoloName)
					savePersonalName(deps.browser, soloName.value);
				return;
			}
			event.preventDefault();
			run();
		});
	};
	follow(online, () => {
		const name = (soloName.value.trim() || defaultSoloName).normalize("NFC");
		const check = checkCreateFields(
			{
				names: { N: "player", E: "player", S: name, W: "player" },
				seat: SOLO_HOST,
				bots: [],
			},
			deps.t,
		);
		if (!check.ok) {
			showErrors(solo, check.errors);
			return;
		}
		const botSetup = parseBotSetup({ seats: [], bidder: bidder.value });
		if (!botSetup) {
			showErrors(solo, [deps.t("Check the bidding engine.")]);
			return;
		}
		savePersonalName(deps.browser, name);
		onCommunity(
			{
				bidder: botSetup.bidder,
				name,
				seat: SOLO_HOST,
				names: { S: name },
				open: { N: "online", E: "online", W: "online" },
			},
			"join",
		);
	});
	const setupHeading = el(
		"h2",
		{ attrs: { tabindex: "-1" } },
		deps.t("Invite friends"),
	);
	const soloForm = el(
		"form",
		{ className: "create" },
		el(
			"div",
			{ className: "create-solo-row" },
			el(
				"label",
				{ attrs: { for: "solo-name" } },
				deps.t("Your display name (optional)"),
			),
			soloName,
			el(
				"div",
				{ className: "opening-modes" },
				el(
					"section",
					{ className: "opening-card" },
					el(
						"div",
						{ className: "opening-card-description" },
						el(
							"span",
							{ className: "mode-symbol", attrs: { "aria-hidden": "true" } },
							"♠",
						),
						el("h3", {}, deps.t("Play with bots")),
						el("p", {}, deps.t("Start a game with three bots.")),
					),
					solo.submit,
				),
				el(
					"section",
					{ className: "opening-card opening-card-friends" },
					el(
						"div",
						{ className: "opening-card-description" },
						el(
							"span",
							{ className: "mode-symbol", attrs: { "aria-hidden": "true" } },
							"♥",
						),
						el("h3", {}, deps.t("Invite friends")),
						el("p", {}, deps.t("Set up a table and share an invitation.")),
					),
					button(
						deps.t("Invite friends"),
						() => {
							setupHeading.focus({ preventScroll: true });
							setupHeading.parentElement?.scrollIntoView({ block: "start" });
						},
						{ attrs: { "data-testid": "invite-friends" } },
					),
				),
				el(
					"section",
					{ className: "opening-card" },
					el(
						"div",
						{ className: "opening-card-description" },
						el(
							"span",
							{ className: "mode-symbol", attrs: { "aria-hidden": "true" } },
							"♣",
						),
						el("h3", {}, deps.t("Find online players")),
						el("p", {}, deps.t("Find a table with other players.")),
					),
					online,
				),
			),
		),
		solo.errors,
	);
	const form = el(
		"form",
		{ className: "create" },
		el("p", { className: "note" }, deps.t("Fill unnamed seats")),
		presets,
		seatGrid(rows),
		el(
			"p",
			{ className: "note" },
			deps.t(
				"Named seats are reserved for friends. Friends join first, then we find the rest.",
			),
		),
		multiplayer.errors,
		multiplayer.submit,
	);
	const showErrors = (
		target: CreateTarget,
		messages: readonly string[],
	): void => {
		target.errors.replaceChildren(
			...messages.map((text) => el("li", {}, text)),
		);
	};
	const disable = (
		control: HTMLButtonElement | HTMLAnchorElement,
		value: boolean,
	): void => {
		if (control instanceof HTMLButtonElement) control.disabled = value;
		else {
			control.setAttribute("aria-disabled", String(value));
			control.tabIndex = value ? -1 : 0;
		}
	};

	// Only a browser that keeps data can hold the first copy of the table (plan §4.3).
	if (!deps.storage.persistent) {
		disable(online, true);
		for (const target of targets) {
			showErrors(target, [deps.t(CANNOT_STORE)]);
			disable(target.submit, true);
		}
	}

	const start = (
		target: CreateTarget,
		fields: CreateFields,
		rememberName: boolean,
	): void => {
		if (
			!deps.storage.persistent ||
			solo.submit.getAttribute("aria-disabled") === "true"
		)
			return;
		for (const other of targets) showErrors(other, []);
		const check = checkCreateFields(fields, deps.t);
		if (!check.ok) {
			showErrors(
				target,
				check.errors.map((error) => deps.t(error)),
			);
			return;
		}
		const botSetup = parseBotSetup({
			seats: fields.bots,
			bidder: bidder.value,
		});
		if (botSetup === undefined) {
			showErrors(target, [deps.t("Check the bidding engine.")]);
			return;
		}
		const config: RoomConfig = { ...check.config, botSetup };
		if (rememberName) savePersonalName(deps.browser, config.names[check.seat]);
		const hostBotSettings =
			fields.bots.length > 0
				? {
						bidder: botSetup.bidder,
						playTimeMs: readSettings(deps.browser).playTimeMs,
						...botTiming(readSettings(deps.browser)),
					}
				: undefined;
		for (const other of targets) disable(other.submit, true);
		disable(online, true);
		target.submit.textContent = deps.t("Creating…");
		void create(target, config, check.seat, hostBotSettings);
	};

	soloForm.addEventListener("submit", (event) => {
		event.preventDefault();
		const names = {} as Record<Seat, string>;
		for (const seat of SEATS)
			names[seat] =
				seat === SOLO_HOST
					? soloName.value.trim() || defaultSoloName
					: BOT_NAME;
		start(
			solo,
			{
				names,
				seat: SOLO_HOST,
				bots: SEATS.filter((seat) => seat !== SOLO_HOST),
			},
			soloName.value.trim() !== defaultSoloName,
		);
	});
	follow(solo.submit, () => soloForm.requestSubmit());

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const names = {} as Record<Seat, string>;
		for (const seat of SEATS)
			names[seat] =
				typeChoices[seat].value === "bot" ? BOT_NAME : nameFields[seat].value;
		const seat = SEATS.find((choice) => meChoices[choice].checked);
		if (seat && !names[seat].trim())
			names[seat] = soloName.value.trim() || defaultSoloName;
		if (
			seat &&
			SEATS.some(
				(seat) =>
					typeChoices[seat].value === "online" ||
					typeChoices[seat].value === "both",
			)
		) {
			const check = checkCreateFields(
				{
					names,
					seat,
					bots: SEATS.filter((seat) => typeChoices[seat].value === "bot"),
				},
				deps.t,
			);
			if (!check.ok) {
				showErrors(multiplayer, check.errors);
				return;
			}
			const open: Partial<Record<Seat, "bot" | "online" | "both">> = {};
			const reserved: Partial<Record<Seat, string>> = {};
			for (const item of SEATS) {
				const bot =
					typeChoices[item].value === "bot" ||
					typeChoices[item].value === "both";
				const online =
					typeChoices[item].value === "online" ||
					typeChoices[item].value === "both";
				if (bot || online)
					open[item] = bot && online ? "both" : bot ? "bot" : "online";
				else if (names[item].trim()) reserved[item] = check.config.names[item];
			}
			savePersonalName(deps.browser, check.config.names[seat]);
			const botSetup = parseBotSetup({ seats: [], bidder: bidder.value });
			if (!botSetup) {
				showErrors(multiplayer, [deps.t("Check the bidding engine.")]);
				return;
			}
			onCommunity({
				bidder: botSetup.bidder,
				name: check.config.names[seat],
				seat,
				names: reserved,
				open,
			});
			return;
		}
		start(
			multiplayer,
			{
				names,
				seat: SEATS.find((choice) => meChoices[choice].checked) ?? "",
				bots: SEATS.filter((item) => typeChoices[item].value === "bot"),
			},
			true,
		);
	});

	async function create(
		target: CreateTarget,
		config: RoomConfig,
		seat: Seat,
		hostBotSettings?: HostBotSettings,
	): Promise<void> {
		const key = newTableKey();
		const identity = await tableIdentity(key, deps.browser);
		if (disposed) return;
		const created = await createTable({
			storage: deps.storage,
			identity,
			seat,
			config,
			module: bridgeModule,
			newId: newCommandId,
			clock: deps.clock,
			memory: deps.memory,
			hostBots: hostBotSettings !== undefined,
		});
		if (disposed) return;
		if (!created.ok) {
			showErrors(target, [
				`${deps.t("Could not create the game")}: ${storageText(created.code, deps.t)}`,
			]);
			for (const other of targets) {
				disable(other.submit, false);
				other.submit.textContent = other.label;
			}
			disable(online, false);
			return;
		}
		void deps.persist();
		onCreated(
			key,
			config,
			seat,
			hostBotSettings,
			target === solo ? "solo" : "create",
		);
	}

	root.replaceChildren(
		el(
			"section",
			{ className: "create-screen" },
			el(
				"div",
				{ className: "create-header" },
				el(
					"a",
					{
						className: "opening-brand",
						attrs: { href: sitePath(pathname, "home") },
					},
					"♠ OpenTrick",
				),
				languageControl(deps),
				el(
					"details",
					{ className: "opening-help" },
					el("summary", {}, deps.t("Help")),
					el(
						"p",
						{},
						deps.t("Use the same browser and the full table link to return."),
					),
				),
			),
			el(
				"section",
				{ className: "opening-hero" },
				el(
					"div",
					{},
					el(
						"p",
						{ className: "opening-eyebrow" },
						deps.t("Free to play · No account needed"),
					),
					el("h1", {}, deps.t("Welcome to the table")),
					el("p", {}, deps.t("A place to play bridge, your way.")),
				),
				el(
					"div",
					{
						className: "opening-illustration",
						attrs: { "aria-hidden": "true" },
					},
					el("span", {}, "A♠"),
					el("span", {}, "A♥"),
				),
			),
			el(
				"section",
				{ className: "create-mode" },
				el("h2", {}, deps.t("Choose how to play")),
				el(
					"p",
					{ className: "note" },
					deps.t("Your name is remembered on this browser."),
				),
				soloForm,
			),
			discovery.element,
			el(
				"p",
				{ className: "invitation-guidance" },
				deps.t("Have an invitation? Open the link you received."),
			),
			el(
				"section",
				{ className: "create-mode setup-mode" },
				setupHeading,
				el(
					"p",
					{},
					deps.t(
						"Choose your seat, create the table, and share the invitation link.",
					),
				),
				form,
				el(
					"details",
					{ className: "create-options" },
					el("summary", {}, deps.t("Game options")),
					el("label", {}, `${deps.t("Bidding bot")}: `, bidder),
					el("label", {}, `${deps.t("Scoring")}: `, scoring),
				),
			),
		),
	);
	if (entry === "solo" || entry === "join")
		queueMicrotask(() => {
			if (!disposed) (entry === "solo" ? solo.submit : online).click();
		});
	return () => {
		disposed = true;
		discovery.dispose();
	};
}
