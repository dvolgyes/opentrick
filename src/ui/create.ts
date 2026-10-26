import type { HostBotSettings } from "../bot/host-runner";
import { bridgeModule } from "../game/bridge";
import { newCommandId } from "../ids";
import { newTableKey } from "../p2p/link";
import { CANNOT_STORE, createTable, tableIdentity } from "../p2p/table";
import {
	DEFAULT_BOT_SETUP,
	parseBotSetup,
	type RoomConfig,
	SEAT_NAMES,
	SEATS,
	type Seat,
} from "../protocol";
import type { Bookmark } from "./bookmark";
import type { AppDeps, Dispose } from "./deps";
import { el } from "./dom";
import { languageControl } from "./language-control";
import {
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

/** A solo game: the creator hosts at South against three bots. */
const SOLO_HOST: Seat = "S";

/** One way to start a game: its button and the list that explains a refusal. */
interface CreateTarget {
	readonly submit: HTMLButtonElement;
	readonly errors: HTMLElement;
	readonly label: string;
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
	) => void,
): Dispose {
	let disposed = false;
	const nameFields = {} as Record<Seat, HTMLInputElement>;
	const meChoices = {} as Record<Seat, HTMLInputElement>;
	const botChoices = {} as Record<Seat, HTMLInputElement>;
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
				placeholder: "player",
				"aria-label": `${deps.t(SEAT_NAMES[seat])} ${deps.t("Name").toLowerCase()}`,
			},
		});
		name.value = prefillBots.includes(seat)
			? BOT_NAME
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
		me.checked = seat === host;
		bot.checked = prefillBots.includes(seat);
		meChoices[seat] = me;
		botChoices[seat] = bot;
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
				el("label", {}, deps.t("Name"), name),
				el("label", {}, me, ` ${deps.t("Host")}`),
				el("label", {}, bot, ` ${deps.t("Bot")}`),
			),
		};
	});

	// The host seat cannot be a bot, and a bot seat cannot host.
	const syncChoices = (): void => {
		for (const seat of SEATS) {
			botChoices[seat].disabled = meChoices[seat].checked;
			meChoices[seat].disabled = botChoices[seat].checked;
		}
	};
	for (const seat of SEATS) {
		nameFields[seat].addEventListener("input", () => {
			if (!botChoices[seat].checked) return;
			botChoices[seat].checked = false;
			syncChoices();
		});
		botChoices[seat].addEventListener("change", () => {
			const name = nameFields[seat];
			if (botChoices[seat].checked) name.value = BOT_NAME;
			else if (isBotName(name.value)) name.value = "";
			syncChoices();
		});
		meChoices[seat].addEventListener("change", syncChoices);
	}
	syncChoices();

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
		{ attrs: { name: "bot-bidder", "aria-label": deps.t("Bidding engine") } },
		el(
			"option",
			{ attrs: { value: "sl" } },
			deps.t("Local · WBridge5 imitation"),
		),
		el(
			"option",
			{ attrs: { value: "rl-fsp" } },
			deps.t("Local · RL/FSP learned system"),
		),
	);
	bidder.value = setup.bidder;

	const errorList = (testId: string): HTMLElement =>
		el("ul", {
			className: "errors",
			attrs: { role: "alert", "data-testid": testId },
		});
	const solo: CreateTarget = {
		submit: el(
			"button",
			{ attrs: { type: "submit", "data-testid": "create-solo" } },
			deps.t("Start solo game"),
		),
		errors: errorList("solo-errors"),
		label: deps.t("Start solo game"),
	};
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
		attrs: { type: "text", name: "solo-name", autocomplete: "off" },
	});
	soloName.value = readPersonalName(deps.browser) || defaultSoloName;
	const soloForm = el(
		"form",
		{ className: "create" },
		el("label", {}, deps.t("Your name"), soloName),
		solo.errors,
		solo.submit,
	);
	const form = el(
		"form",
		{ className: "create" },
		seatGrid(rows),
		el(
			"p",
			{ className: "note" },
			deps.t("Leave a name blank or use player to ask the person joining."),
		),
		el("label", {}, `${deps.t("Scoring")}: `, scoring),
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

	// Only a browser that keeps data can hold the first copy of the table (plan §4.3).
	if (!deps.storage.persistent)
		for (const target of targets) {
			showErrors(target, [deps.t(CANNOT_STORE)]);
			target.submit.disabled = true;
		}

	const start = (
		target: CreateTarget,
		fields: CreateFields,
		rememberName: boolean,
	): void => {
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
					}
				: undefined;
		for (const other of targets) other.submit.disabled = true;
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

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const names = {} as Record<Seat, string>;
		for (const seat of SEATS) names[seat] = nameFields[seat].value;
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
				other.submit.disabled = false;
				other.submit.textContent = other.label;
			}
			return;
		}
		void deps.persist();
		onCreated(key, config, seat, hostBotSettings);
	}

	root.replaceChildren(
		el(
			"section",
			{ className: "create-screen" },
			el("h1", {}, deps.t("Create game")),
			el(
				"div",
				{ className: "create-options" },
				el("label", {}, `${deps.t("Bidding engine")} `, bidder),
				languageControl(deps),
			),
			el(
				"section",
				{ className: "create-mode" },
				el("h2", {}, deps.t("Solo game")),
				soloForm,
			),
			el(
				"section",
				{ className: "create-mode" },
				el("h2", {}, deps.t("Multiplayer game")),
				el(
					"p",
					{},
					deps.t(
						"Enter the four players. Choose your seat. Your browser hosts first; anyone at the table can take over.",
					),
				),
				form,
			),
		),
	);
	return () => {
		disposed = true;
	};
}
