import { cryptoRandomBelow } from "../bridge/deal";
import { MAX_WAIT_MS } from "../community/formation";
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
import { newTableKey } from "../p2p/link";
import { createTable, tableIdentity } from "../p2p/table";
import { isPlayerName, SEAT_NAMES, type Seat } from "../protocol";
import type { AppDeps, Dispose, Navigation } from "./deps";
import { button, copyToClipboard, el } from "./dom";
import { showTable } from "./join";
import { readPersonalName, savePersonalName } from "./personal-name";

const SHAPES: readonly { label: string; seats: readonly Seat[] }[] = [
	{ label: "Solo player", seats: ["N"] },
	{ label: "Opposite pair", seats: ["N", "S"] },
	{ label: "Adjacent pair", seats: ["N", "E"] },
	{ label: "Three players", seats: ["N", "E", "S"] },
	{ label: "Four players", seats: ["N", "E", "S", "W"] },
];

export function showCommunity(
	root: HTMLElement,
	deps: AppDeps,
	route: CommunityRoute,
	navigation: Navigation,
): Dispose {
	let disposed = false;
	let session: CommunitySession | undefined;
	let game: Dispose | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let unlock: (() => void) | undefined;
	const status = el("p", {
		attrs: { role: "status", "data-testid": "community-status" },
	});
	const members = el("ul", { attrs: { "data-testid": "community-members" } });
	const offers = el("p", { attrs: { "data-testid": "community-offers" } });
	const proposal = el("section", {
		attrs: { "data-testid": "community-proposal" },
	});
	const ready = el("input", {
		attrs: { type: "checkbox", "data-testid": "community-ready" },
	});
	const bots = el("input", {
		attrs: { type: "checkbox", "data-testid": "community-bots" },
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
	const shape = el(
		"select",
		{ attrs: { "data-testid": "community-shape" } },
		...SHAPES.map((item, index) =>
			el("option", { attrs: { value: String(index) } }, deps.t(item.label)),
		),
	);
	const apply = (): void => {
		const minutes = Number(wait.value);
		if (!Number.isFinite(minutes) || minutes < 0 || minutes > 60) {
			wait.setCustomValidity(deps.t("Choose a wait between 0 and 60 minutes."));
			wait.reportValidity();
			return;
		}
		wait.setCustomValidity("");
		deps.browser?.setItem("opentrick.community.wait-minutes", wait.value);
		session?.setPreferences(ready.checked, bots.checked, minutes * 60_000);
	};
	ready.addEventListener("change", apply);
	bots.addEventListener("change", apply);
	wait.addEventListener("change", apply);
	const preferences = el(
		"div",
		{},
		el(
			"p",
			{},
			el("label", {}, ready, ` ${deps.t("Ready for compatible table merges")}`),
		),
		el(
			"p",
			{},
			el(
				"label",
				{},
				bots,
				` ${deps.t("Allow bots after waiting (minutes)")} `,
				wait,
			),
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
				(session.prepared
					? "Recovering the agreed table…"
					: session.searching
						? "Searching for compatible players…"
						: "Waiting for your group to be ready."),
		);
		members.replaceChildren(
			...(saved.group?.members ?? []).map((member) =>
				el(
					"li",
					{ attrs: { "data-seat": member.seat } },
					`${deps.t(SEAT_NAMES[member.seat])}: ${member.name}`,
				),
			),
		);
		offers.textContent = deps.t("Discovery: {count} group(s) visible.", {
			count: session.waitingGroups.length,
		});
		ready.disabled =
			bots.disabled =
			wait.disabled =
				session.proposal !== undefined || saved.start !== undefined;
		const merge = session.proposal;
		proposal.replaceChildren();
		if (merge) {
			proposal.append(
				el("p", {}, deps.t("Merge these players into one table?")),
				el(
					"p",
					{},
					merge.result.members
						.map(
							(member) => `${deps.t(SEAT_NAMES[member.seat])}: ${member.name}`,
						)
						.join(" · "),
				),
			);
			if (
				[merge.source.host, merge.destination.host].includes(saved.self) &&
				!session.accepted
			)
				proposal.append(
					button(deps.t("Accept merge"), () => session?.accept(), {
						attrs: { "data-testid": "community-accept" },
					}),
				);
			if (!session.prepared)
				proposal.append(
					button(deps.t("Decline merge"), () => session?.decline(), {
						attrs: { "data-testid": "community-decline" },
					}),
				);
		}
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
		ready.checked = saved.ready;
		bots.checked = saved.allowBots;
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
					identity: (key) => tableIdentity(key, deps.browser),
					change: render,
					play: async (key, start, self) => {
						const member = start.group.members.find((row) => row.id === self);
						const host = start.group.members.find(
							(row) => row.id === start.group.host,
						);
						if (!member || !host || disposed) return;
						const identity = await tableIdentity(key, deps.browser);
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
							`${location.pathname}${communityGameFragment(key)}`,
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
							);
						});
					},
				},
				saved,
			);
			root.replaceChildren(
				el(
					"section",
					{ className: "create", attrs: { "data-testid": "community" } },
					el("h1", {}, deps.t("Community game")),
					status,
					members,
					preferences,
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
							);
							void copyToClipboard(url.href).then((text) => {
								status.textContent = deps.t(text);
							});
						},
						{ attrs: { "data-testid": "community-invite" } },
					),
					offers,
					proposal,
					el(
						"p",
						{},
						deps.t(
							"Community games have no audio or video calls. A bot covers an absent player until the board ends.",
						),
					),
					button(deps.t("Reload"), navigation.reload),
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
		let saved = readCommunity(deps.browser, route.key);
		for (let count = 0; saved && count < 4; count++) {
			const next = readCommunity(deps.browser, saved.key);
			if (!next || next.key === saved.key) break;
			saved = next;
		}
		return saved;
	};
	const saved = load();
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
			...(route.kind === "create"
				? [el("label", {}, ` ${deps.t("Group seating")} `, shape)]
				: []),
			preferences,
			el(
				"button",
				{ attrs: { type: "submit", "data-testid": "community-enter" } },
				deps.t("Find players"),
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
			const key = route.kind === "party" ? route.key : newTableKey();
			const owner = route.kind === "party" ? route.owner : self;
			const expected =
				route.kind === "party"
					? route.seats
					: (SHAPES[Number(shape.value)]?.seats ?? ["N"]);
			history.replaceState(
				null,
				"",
				`${location.pathname}${partyFragment(key, owner, expected)}`,
			);
			void begin({
				self,
				name: player,
				key,
				owner,
				expected,
				ready: ready.checked,
				allowBots: bots.checked,
				waitMs: minutes * 60_000,
				waitedMs: 0,
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
