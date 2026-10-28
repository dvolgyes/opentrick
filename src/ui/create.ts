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
	const botChoices = {} as Record<Seat, HTMLInputElement>;
	const onlineChoices = {} as Record<Seat, HTMLInputElement>;
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
		const bot = el("input", {
			attrs: { type: "checkbox", name: `bot-${seat}`, value: seat },
		});
		const online = el("input", {
			attrs: { type: "checkbox", name: `online-${seat}`, value: seat },
		});
		me.checked = seat === host;
		bot.checked = prefillBots.includes(seat);
		meChoices[seat] = me;
		botChoices[seat] = bot;
		onlineChoices[seat] = online;
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
				name,
				el(
					"div",
					{ className: "seat-roles" },
					el("label", {}, me, ` ${deps.t("Host")}`),
					el("label", {}, bot, ` ${deps.t("Bot")}`),
					el("label", {}, online, ` ${deps.t("Online player")}`),
				),
			),
		};
	});

	// The host seat cannot be a bot, and a bot seat cannot host.
	const syncChoices = (): void => {
		for (const seat of SEATS) {
			const named =
				nameFields[seat].value.trim().length > 0 &&
				!isBotName(nameFields[seat].value);
			if (named || meChoices[seat].checked) {
				botChoices[seat].checked = false;
				onlineChoices[seat].checked = false;
			}
			botChoices[seat].disabled = onlineChoices[seat].disabled =
				named || meChoices[seat].checked;
			meChoices[seat].disabled =
				botChoices[seat].checked || onlineChoices[seat].checked;
		}
	};
	for (const seat of SEATS) {
		nameFields[seat].addEventListener("input", () => {
			syncChoices();
		});
		botChoices[seat].addEventListener("change", () => {
			const name = nameFields[seat];
			if (isBotName(name.value)) name.value = "";
			syncChoices();
		});
		onlineChoices[seat].addEventListener("change", syncChoices);
		meChoices[seat].addEventListener("change", syncChoices);
	}
	syncChoices();
	const presets = el(
		"div",
		{
			className: "seat-presets",
			attrs: { "aria-label": deps.t("Fill unnamed seats") },
		},
		...(["Bots", "Online players", "Both"] as const).map((label) =>
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
						botChoices[seat].checked = label !== "Online players";
						onlineChoices[seat].checked = label !== "Bots";
					}
					syncChoices();
				},
				{
					attrs: {
						"data-testid": `preset-${label === "Bots" ? "bots" : label === "Both" ? "both" : "online"}`,
					},
				},
			),
		),
	);

	const scoring = el(
		"select",
		{ attrs: { name: "scoring" } },
		el("option", { attrs: { value: "duplicate" } }, deps.t("Duplicate")),
		el(
			"option",
			{ attrs: { value: "chicago", disabled: "" } },
			deps.t("Chicago (later)"),
		),
		el(
			"option",
			{ attrs: { value: "rubber", disabled: "" } },
			deps.t("Rubber (later)"),
		),
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
	const online = el(
		"a",
		{
			className: "button",
			attrs: {
				href: sitePath(pathname, "join"),
				"data-testid": "join-online",
			},
		},
		deps.t("Online players"),
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
		const name = soloName.value.trim().normalize("NFC");
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
	const soloForm = el(
		"form",
		{ className: "create" },
		el(
			"div",
			{ className: "create-solo-row" },
			el("label", { attrs: { for: "solo-name" } }, `${deps.t("Name")}:`),
			soloName,
			solo.submit,
			online,
		),
		solo.errors,
	);
	const form = el(
		"form",
		{ className: "create" },
		seatGrid(rows, presets),
		el(
			"p",
			{ className: "note" },
			deps.t(
				"Named seats are reserved for friends. Choose Bot, Online player, or both for unnamed seats.",
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
			names[seat] = seat === SOLO_HOST ? soloName.value : BOT_NAME;
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
			names[seat] = botChoices[seat].checked
				? BOT_NAME
				: nameFields[seat].value;
		const seat = SEATS.find((choice) => meChoices[choice].checked);
		if (seat && SEATS.some((seat) => onlineChoices[seat].checked)) {
			const check = checkCreateFields(
				{ names, seat, bots: SEATS.filter((seat) => botChoices[seat].checked) },
				deps.t,
			);
			if (!check.ok) {
				showErrors(multiplayer, check.errors);
				return;
			}
			const open: Partial<Record<Seat, "bot" | "online" | "both">> = {};
			const reserved: Partial<Record<Seat, string>> = {};
			for (const item of SEATS) {
				const bot = botChoices[item].checked;
				const online = onlineChoices[item].checked;
				if (bot || online)
					open[item] = bot && online ? "both" : bot ? "bot" : "online";
				else if (nameFields[item].value.trim())
					reserved[item] = check.config.names[item];
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
				bots: SEATS.filter((item) => botChoices[item].checked),
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
				el("a", { attrs: { href: sitePath(pathname, "home") } }, "OpenTrick"),
				el(
					"h1",
					{},
					el(
						"a",
						{ attrs: { href: sitePath(pathname, "create") } },
						deps.t("Create game"),
					),
				),
				languageControl(deps),
			),
			el(
				"div",
				{ className: "create-options" },
				el("label", {}, `${deps.t("Bidding bot")}: `, bidder),
				el("label", {}, `${deps.t("Scoring")}: `, scoring),
			),
			el("section", { className: "create-mode" }, soloForm),
			discovery.element,
			el(
				"section",
				{ className: "create-mode" },
				el("h2", {}, deps.t("Multiplayer game")),
				el(
					"p",
					{},
					deps.t(
						"Enter the players. Choose your seat. Start the game. Share the link.",
					),
				),
				form,
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
