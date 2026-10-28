import type { TableController } from "../p2p/table";
import { playerName, playersFor, unnamedPlayer } from "../players";
import { SEAT_NAMES, SEATS, type Seat } from "../protocol";
import type { AppDeps } from "./deps";
import { button, el } from "./dom";
import { seatGrid } from "./seat-grid";

/**
 * Host changes use the generation and name revision that the editor actually displayed. Save writes the seats that
 * changed and closes the editor; Cancel closes it and writes nothing.
 */
export function playerEditor(
	deps: AppDeps,
	controller: TableController,
	switchToHuman: (seat: Seat) => void,
) {
	const element = el("dialog", {
		className: "player-editor",
		attrs: {
			"data-testid": "player-editor",
			"aria-labelledby": "player-editor-title",
		},
	});
	const open = () => {
		const view = controller.view();
		const table = view.table;
		if (!view.hosting || !table) return;
		const profiles = playersFor(table);
		const cards = SEATS.map((seat) => {
			const profile = profiles[seat];
			let generation = table.seats.find((row) => row.seat === seat)?.gen ?? 0;
			let revision = profile.rev;
			let shownName = profile.name;
			let shownAsk = profile.askOnEntry;
			// A bot seat opened for a new player: Save writes it and then gives the seat to a human.
			let openSeat = false;
			const name = el("input", {
				attrs: {
					type: "text",
					"aria-label": `${deps.t(SEAT_NAMES[seat])} ${deps.t("Name")}`,
					"data-testid": `rename-${seat}`,
				},
			});
			name.value = profile.name;
			const ask = el("input", { attrs: { type: "checkbox" } });
			ask.checked = profile.askOnEntry;
			const status = el("p", { attrs: { role: "status" } });
			const write = async (
				value: string,
				askOnEntry: boolean,
			): Promise<boolean> => {
				const normalized = playerName(value.trim() === "" ? "player" : value);
				if (!normalized) {
					status.textContent = deps.t(
						"Enter a valid name of at most 40 characters.",
					);
					return false;
				}
				const ok = await controller.renameSeat(
					seat,
					normalized,
					generation,
					revision,
					askOnEntry,
				);
				if (!ok) {
					const latest = controller.view().table;
					const changed =
						latest &&
						(latest.seats.find((row) => row.seat === seat)?.gen !==
							generation ||
							playersFor(latest)[seat].rev !== revision);
					status.textContent = changed
						? deps.t("The seat changed. Close this dialog and try again.")
						: deps.t("The host could not change that seat.");
					return false;
				}
				const current = controller.view().table;
				if (!current) return false;
				const updated = playersFor(current)[seat];
				generation = current.seats.find((row) => row.seat === seat)?.gen ?? 0;
				revision = updated.rev;
				shownName = updated.name;
				shownAsk = updated.askOnEntry;
				name.value = updated.name;
				ask.checked = updated.askOnEntry;
				status.textContent = deps.t("Saved.");
				return true;
			};
			/** Writes this seat when it changed; true when nothing is left to save. */
			const save = async (): Promise<boolean> => {
				if (openSeat) {
					if (!(await write("player", true))) return false;
					openSeat = false;
					switchToHuman(seat);
					return true;
				}
				if (name.value === shownName && ask.checked === shownAsk) return true;
				return write(name.value, ask.checked || unnamedPlayer(name.value));
			};
			const card = el(
				"div",
				{ className: "player-editor-seat" },
				el("h3", {}, deps.t(SEAT_NAMES[seat])),
				el(
					"label",
					{ className: "player-editor-name" },
					el("span", {}, deps.t("Name")),
					name,
				),
				el("label", {}, ask, deps.t("Ask the player for a name")),
				status,
			);
			if (
				view.roster?.bots.includes(seat) &&
				!view.roster.autoplaySeats.includes(seat)
			) {
				const replace = button(deps.t("Open seat for a new player"), () => {
					openSeat = true;
					name.value = "player";
					ask.checked = true;
					replace.disabled = true;
				});
				replace.classList.add("player-editor-open");
				card.append(replace);
			}
			return { seat, element: card, save };
		});
		const save = el("button", { attrs: { type: "submit" } }, deps.t("Save"));
		const form = el(
			"form",
			{},
			el(
				"h2",
				{ attrs: { id: "player-editor-title" } },
				deps.t("Player names"),
			),
			seatGrid(cards, { bottom: view.seat ?? "S" }),
			el(
				"div",
				{ className: "player-editor-actions" },
				save,
				button(deps.t("Cancel"), () => element.close()),
			),
		);
		// The seats save one after another; a refused seat keeps the editor open with its message.
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			save.disabled = true;
			void (async () => {
				let saved = true;
				for (const card of cards) saved = (await card.save()) && saved;
				save.disabled = false;
				if (saved) element.close();
			})();
		});
		element.replaceChildren(form);
		element.showModal();
	};
	return { element, open };
}
