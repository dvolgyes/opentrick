import { cryptoRandomBelow } from "../bridge/deal";
import { MAX_WAIT_MS, openSeats } from "../community/formation";
import {
	type CommunityRoute,
	communityGameFragment,
	partyFragment,
} from "../community/link";
import {
	type CommunitySaved,
	CommunitySession,
	readCommunity,
} from "../community/session";
import { bridgeModule } from "../game/bridge";
import { newCommandId } from "../ids";
import { createTable, tableIdentity } from "../p2p/table";
import { isPlayerName, isSeat, SEAT_NAMES, SEATS } from "../protocol";
import type { AppDeps, Dispose, Navigation } from "./deps";
import { button, copyToClipboard, el } from "./dom";
import { showTable } from "./join";
import { readPersonalName, savePersonalName } from "./personal-name";
import { seatGrid } from "./seat-grid";

export function showCommunity(
	root: HTMLElement,
	deps: AppDeps,
	route: CommunityRoute,
	navigation: Navigation,
	initial?: CommunitySaved,
): Dispose {
	let disposed = false;
	let session: CommunitySession | undefined;
	let game: Dispose | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let unlock: (() => void) | undefined;
	const status = el("p", {
		attrs: { role: "status", "data-testid": "community-status" },
	});
	const members = el("div", {
		className: "community-table",
		attrs: { "data-testid": "community-members" },
	});
	const wait = el("input", {
		attrs: {
			type: "number",
			min: "0",
			max: String(MAX_WAIT_MS / 60_000),
			step: "0.1",
			"data-testid": "community-wait",
		},
	});
	wait.value = deps.browser?.getItem("opentrick.community.wait-minutes") ?? "2";
	const name = el("input", {
		attrs: {
			type: "text",
			maxlength: "40",
			"data-testid": "community-name",
			autocomplete: "nickname",
		},
	});
	name.value = readPersonalName(deps.browser);
	name.addEventListener("input", () => name.setCustomValidity(""));
	const seatChoice = el(
		"select",
		{ attrs: { "data-testid": "community-seat" } },
		...(route.kind === "party" ? route.seats.slice(1) : []).map((seat) =>
			el(
				"option",
				{ attrs: { value: seat } },
				`${deps.t(SEAT_NAMES[seat])}${route.kind === "party" && route.setup?.names[seat] ? `: ${route.setup.names[seat]}` : ""}`,
			),
		),
	);
	const fillReservedName = (): void => {
		if (route.kind === "party" && isSeat(seatChoice.value))
			name.value =
				route.setup?.names[seatChoice.value] ?? readPersonalName(deps.browser);
	};
	seatChoice.addEventListener("change", fillReservedName);
	fillReservedName();
	const apply = (): void => {
		const minutes = Number(wait.value);
		if (!Number.isFinite(minutes) || minutes < 0 || minutes > 60) {
			wait.setCustomValidity(deps.t("Choose a wait between 0 and 60 minutes."));
			wait.reportValidity();
			return;
		}
		wait.setCustomValidity("");
		deps.browser?.setItem("opentrick.community.wait-minutes", wait.value);
		if (session)
			session.setPreferences(true, session.saved.allowBots, minutes * 60_000);
	};
	wait.addEventListener("change", apply);
	const preferences = el(
		"details",
		{},
		el("summary", {}, deps.t("Bot wait")),
		el(
			"p",
			{},
			el("label", {}, `${deps.t("Allow bots after waiting (minutes)")} `, wait),
		),
		el(
			"p",
			{},
			deps.t("Everyone must agree before empty seats are filled with bots."),
		),
	);
	const render = (): void => {
		if (!session || disposed || game) return;
		const saved = session.saved;
		root.dataset.communityPhase = session.prepared
			? "joining"
			: session.searching
				? "searching"
				: "forming";
		status.textContent = deps.t(
			session.problem ??
				(session.proposal || saved.start || saved.group?.members.length === 4
					? "Joining table…"
					: session.searching
						? "Searching for compatible players…"
						: "Waiting for invited players…"),
		);
		members.replaceChildren(
			seatGrid(
				SEATS.map((seat) => {
					const member = saved.group?.members.find(
						(member) => member.seat === seat,
					);
					const choice = saved.group
						? openSeats(saved.group)[seat]
						: saved.open?.[seat];
					const label =
						member?.name ??
						(choice === "bot"
							? deps.t("Bot")
							: choice === "online"
								? deps.t("Online player")
								: choice === "both"
									? deps.t("Bot or online player")
									: (saved.names?.[seat] ?? deps.t("Reserved for a friend")));
					return {
						seat,
						element: el(
							"section",
							{},
							el("h2", {}, deps.t(SEAT_NAMES[seat])),
							el("p", {}, label),
							...(!member && saved.expected.includes(seat)
								? [
										el(
											"p",
											{ className: "note" },
											deps.t("Waiting for your friend"),
										),
									]
								: []),
						),
					};
				}),
				status,
			),
		);
		wait.disabled = session.proposal !== undefined || saved.start !== undefined;
		preferences.hidden = !Object.values(
			saved.group ? openSeats(saved.group) : (saved.open ?? {}),
		).includes("both");
	};
	const begin = async (saved: CommunitySaved): Promise<void> => {
		if (disposed) return;
		if (!deps.browser || !deps.storage.persistent || !deps.openCommunity) {
			status.textContent = deps.t(
				"This browser could not save matchmaking progress.",
			);
			return;
		}
		const store = deps.browser;
		const open = deps.openCommunity;
		const active = saved.start
			? saved
			: { ...saved, identityScope: "member" as const };
		const identityFor = (key: string) =>
			tableIdentity(
				key,
				store,
				active.identityScope === "member" ? active.self : undefined,
			);
		if (route.kind === "party")
			history.replaceState(
				null,
				"",
				`${location.pathname}${partyFragment(route.key, route.owner, route.seats, route.setup, saved.self)}`,
			);
		wait.value = String(saved.waitMs / 60_000);
		const run = async (): Promise<void> => {
			if (disposed) return;
			session = new CommunitySession(
				{
					store,
					open,
					now: deps.clock.monotonic,
					id: newCommandId,
					random: cryptoRandomBelow,
					identity: identityFor,
					change: render,
					play: async (key, start, self) => {
						const member = start.group.members.find((row) => row.id === self);
						const host = start.group.members.find(
							(row) => row.id === start.group.host,
						);
						if (!member || !host || disposed) return;
						const identity = await identityFor(key);
						const existing = await deps.storage.load(
							identity.tableId,
							member.seat,
						);
						if (!existing.ok) {
							status.textContent = deps.t(
								"This browser could not save matchmaking progress.",
							);
							return;
						}
						let creator = false;
						if (
							member.id === host.id &&
							existing.value === null &&
							!saved.playing
						) {
							const created = await createTable({
								storage: deps.storage,
								identity,
								seat: member.seat,
								config: start.config,
								module: bridgeModule,
								newId: newCommandId,
								clock: deps.clock,
								memory: deps.memory,
								hostBots: true,
							});
							if (!created.ok) {
								status.textContent = deps.t(created.detail);
								return;
							}
							creator = true;
						}
						if (disposed) return;
						history.replaceState(
							null,
							"",
							`${location.pathname}${communityGameFragment(key, self)}`,
						);
						delete root.dataset.communityPhase;
						await new Promise<void>((resolve) => {
							game = showTable(
								root,
								deps,
								key,
								creator,
								navigation,
								member.seat,
								{ config: start.config, host: host.seat },
								undefined,
								undefined,
								true,
								(view) => {
									if (view.ready && view.table && view.allConnected) resolve();
								},
								identity,
							);
						});
					},
				},
				{ ...active, ready: true },
			);
			root.replaceChildren(
				el(
					"section",
					{ className: "create", attrs: { "data-testid": "community" } },
					el("h1", {}, deps.t("Community game")),
					members,
					preferences,
					...(route.kind === "party" && route.seats.length > 1
						? [
								button(
									deps.t("Copy group invitation"),
									() => {
										const current = session?.saved;
										if (!current) return;
										const url = new URL(deps.pageUrl());
										url.search = "";
										url.hash = partyFragment(
											current.key,
											current.owner,
											current.expected,
											current.open
												? {
														open: current.group
															? openSeats(current.group)
															: current.open,
														names: Object.fromEntries(
															current.expected.flatMap((seat) => {
																const name =
																	current.group?.members.find(
																		(member) => member.seat === seat,
																	)?.name ?? current.names?.[seat];
																return name ? [[seat, name]] : [];
															}),
														),
														waitMs: current.waitMs,
													}
												: undefined,
										);
										void copyToClipboard(url.href).then((text) => {
											status.textContent = deps.t(text);
										});
									},
									{ attrs: { "data-testid": "community-invite" } },
								),
							]
						: []),
					el(
						"p",
						{},
						deps.t(
							"Community games have no audio or video calls. A bot covers an absent player until the board ends.",
						),
					),
					button(deps.t("Create new game"), navigation.createNew),
				),
			);
			await session.start();
			if (disposed) {
				session.stop();
				return;
			}
			timer = setInterval(() => session?.tick(), 500);
			render();
		};
		if (navigator.locks) {
			void navigator.locks.request(
				`opentrick.community.${saved.self}`,
				{ ifAvailable: true },
				async (lock) => {
					if (!lock) {
						status.textContent = deps.t(
							"This group is already open in another tab.",
						);
						return;
					}
					await run();
					if (!disposed)
						await new Promise<void>((resolve) => {
							unlock = resolve;
						});
				},
			);
		} else await run();
	};

	const load = (): CommunitySaved | undefined => {
		if (route.kind !== "game" && route.kind !== "party") return undefined;
		if (!deps.browser) return undefined;
		let saved = readCommunity(deps.browser, route.key, route.member);
		// New invitations omit the personal marker. A shared browser must still offer a friend their own seat.
		if (
			route.kind === "party" &&
			!route.member &&
			saved?.identityScope === "member"
		)
			return undefined;
		for (let count = 0; saved && count < 4; count++) {
			const next = readCommunity(deps.browser, saved.key, saved.self);
			if (!next || next.key === saved.key) break;
			saved = next;
		}
		return saved;
	};
	const saved = initial ?? load();
	root.replaceChildren(
		el(
			"section",
			{ className: "create" },
			el("h1", {}, deps.t("Community game")),
			status,
		),
	);
	if (saved) void begin(saved);
	else if (route.kind === "game" || route.kind === "invalid") {
		status.textContent = deps.t(
			"This browser has no saved reservation for this community game.",
		);
		root.append(button(deps.t("Create new game"), navigation.createNew));
	} else {
		const form = el(
			"form",
			{ className: "create" },
			el("label", {}, `${deps.t("Your name")} `, name),
			el("label", {}, `${deps.t("Choose your seat.")} `, seatChoice),
			el(
				"p",
				{},
				deps.t(
					"Your seat is reserved. Joining starts automatic matching for the open seats.",
				),
			),
			el(
				"button",
				{ attrs: { type: "submit", "data-testid": "community-enter" } },
				deps.t("Join table"),
			),
		);
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			const player = name.value.trim().normalize("NFC");
			if (!isPlayerName(player)) {
				name.setCustomValidity(deps.t("Enter your name."));
				name.reportValidity();
				return;
			}
			name.setCustomValidity("");
			const minutes = Number(wait.value);
			if (!Number.isFinite(minutes) || minutes < 0 || minutes > 60) return;
			savePersonalName(deps.browser, player);
			const self = newCommandId();
			if (route.kind !== "party" || !isSeat(seatChoice.value)) return;
			const key = route.key;
			const owner = route.owner;
			const expected = route.seats;
			history.replaceState(
				null,
				"",
				`${location.pathname}${partyFragment(key, owner, expected, route.setup, self)}`,
			);
			void begin({
				self,
				name: player,
				key,
				owner,
				expected,
				ready: true,
				preferredSeat: seatChoice.value,
				allowBots: route.setup
					? Object.values(route.setup.open).some(
							(choice) => choice !== "online",
						)
					: true,
				waitMs: route.setup?.waitMs ?? minutes * 60_000,
				waitedMs: 0,
				...(route.setup
					? { open: route.setup.open, names: route.setup.names }
					: {}),
			});
		});
		root.append(form);
	}
	return () => {
		disposed = true;
		session?.stop();
		game?.();
		if (timer) clearInterval(timer);
		unlock?.();
	};
}
