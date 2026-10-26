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
import { checkCreateFields, DEFAULT_CREATE_FIELDS, storageText } from "./model";
import { readPersonalName, savePersonalName } from "./personal-name";
import { seatGrid } from "./seat-grid";
import { readSettings } from "./settings";

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
		name.value =
			prefill.names[seat] ??
			(seat === host
				? readPersonalName(deps.browser)
				: DEFAULT_CREATE_FIELDS.names[seat]);
		nameFields[seat] = name;
		const me = el("input", {
			attrs: { type: "radio", name: "me", value: seat },
		});
		const bot = el("input", {
			attrs: { type: "checkbox", name: `bot-${seat}`, value: seat },
		});
		me.checked = seat === host;
		bot.checked = (prefill.botSetup ?? DEFAULT_BOT_SETUP).seats.includes(seat);
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
	const errors = el("ul", {
		className: "errors",
		attrs: { role: "alert", "data-testid": "errors" },
	});
	const submit = el(
		"button",
		{ attrs: { type: "submit", "data-testid": "create" } },
		deps.t("Create game"),
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
		errors,
		submit,
		el(
			"fieldset",
			{},
			el("legend", {}, deps.t("Optional automated players")),
			el("label", {}, deps.t("Bidding engine"), bidder),
			el(
				"p",
				{},
				deps.t(
					"Local bidding runs in your browser. Learned conventions can differ from SAYC.",
				),
			),
		),
	);

	const showErrors = (messages: readonly string[]): void => {
		errors.replaceChildren(...messages.map((text) => el("li", {}, text)));
	};

	// Only a browser that keeps data can hold the first copy of the table (plan §4.3).
	if (!deps.storage.persistent) {
		showErrors([deps.t(CANNOT_STORE)]);
		submit.disabled = true;
	}

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const names = {} as Record<Seat, string>;
		for (const seat of SEATS) names[seat] = nameFields[seat].value;
		const seat = SEATS.find((choice) => meChoices[choice].checked) ?? "";
		const check = checkCreateFields({ names, seat }, deps.t);
		if (!check.ok) {
			showErrors(check.errors.map((error) => deps.t(error)));
			return;
		}
		const botSeats = SEATS.filter((item) => botChoices[item].checked);
		const botSetup = parseBotSetup({
			seats: botSeats,
			bidder: bidder.value,
		});
		if (botSetup === undefined) {
			showErrors([deps.t("Check the bidding engine.")]);
			return;
		}
		const config: RoomConfig = { ...check.config, botSetup };
		savePersonalName(deps.browser, config.names[check.seat]);
		const hostBotSettings =
			botSeats.length > 0
				? {
						bidder: botSetup.bidder,
						playTimeMs: readSettings(deps.browser).playTimeMs,
					}
				: undefined;
		showErrors([]);
		submit.disabled = true;
		submit.textContent = deps.t("Creating…");
		void create(config, check.seat, hostBotSettings);
	});

	async function create(
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
			showErrors([
				`${deps.t("Could not create the game")}: ${storageText(created.code, deps.t)}`,
			]);
			submit.disabled = false;
			submit.textContent = deps.t("Create game");
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
				"p",
				{},
				deps.t(
					"Enter the four players. Choose your seat. Your browser hosts first; anyone at the table can take over.",
				),
			),
			form,
		),
	);
	return () => {
		disposed = true;
	};
}
