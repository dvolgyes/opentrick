import type { TableController } from "../p2p/table";
import { playerName, playersFor, unnamedPlayer } from "../players";
import { SEAT_NAMES, SEATS, type Seat } from "../protocol";
import type { AppDeps } from "./deps";
import { button, el } from "./dom";
import { seatGrid } from "./seat-grid";

/** Host changes use the generation and name revision that the editor actually displayed. */
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
			const save = el(
				"button",
				{ attrs: { type: "submit" } },
				deps.t("Save name"),
			);
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
				save.disabled = true;
				const ok = await controller.renameSeat(
					seat,
					normalized,
					generation,
					revision,
					askOnEntry,
				);
				save.disabled = false;
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
				name.value = updated.name;
				ask.checked = updated.askOnEntry;
				status.textContent = deps.t("Saved.");
				return true;
			};
			const form = el(
				"form",
				{},
				el("h3", {}, deps.t(SEAT_NAMES[seat])),
				el("label", {}, deps.t("Name"), name),
				el("label", {}, ask, deps.t("Ask each new player for a name")),
				save,
				status,
			);
			form.addEventListener("submit", (event) => {
				event.preventDefault();
				void write(name.value, ask.checked || unnamedPlayer(name.value));
			});
			if (
				view.roster?.bots.includes(seat) &&
				!view.roster.autoplaySeats.includes(seat)
			) {
				const replace = button(deps.t("Open seat for a new player"), () => {
					replace.disabled = true;
					void write("player", true).then((ok) => {
						replace.disabled = false;
						if (ok) switchToHuman(seat);
					});
				});
				form.append(replace);
			}
			return { seat, element: form };
		});
		element.replaceChildren(
			el(
				"h2",
				{ attrs: { id: "player-editor-title" } },
				deps.t("Player names"),
			),
			seatGrid(cards),
			button(deps.t("Close"), () => element.close()),
		);
		element.showModal();
	};
	return { element, open };
}
