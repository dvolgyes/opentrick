import { updateUrl } from "../build";
import { parseCommunityRoute } from "../community/link";
import { parseRoute, tableFragment } from "../p2p/link";
import {
	bookmarkQuery,
	parseBookmark,
	parseRoomSetup,
	parseSelectedPlayer,
	selectedPlayerQuery,
	sharedQuery,
} from "./bookmark";
import { showCommunity } from "./community-view";
import { showCreate } from "./create";
import type { AppDeps, Dispose, Navigation } from "./deps";
import { copyToClipboard } from "./dom";
import { showLinkProblem, showTable } from "./join";
import { languageControl } from "./language-control";
import { screenWakeLock, WakeLockPolicy } from "./wake-lock";

/**
 * Routes on the URL fragment: empty → create, `#k=<key>` → the table. The query prefills the create screen
 * and can select a seat in a table. Leaving a screen disposes it, so a previous table's mesh and timers stop before
 * the next table starts.
 */
export function startApp(root: HTMLElement, deps: AppDeps): void {
	// Every page keeps the screen on: a phone that sleeps stops the page, and then the other players cannot reach it.
	const wakeLock = new WakeLockPolicy(screenWakeLock);
	wakeLock.update(true);
	document.addEventListener("visibilitychange", () => wakeLock.pageShown());
	const corner = languageControl(deps);
	let dispose: Dispose | undefined;
	const navigation: Navigation = {
		createNew: () => {
			// Stop the table first, then load a new document: the site root has no setup query and no table link.
			dispose?.();
			dispose = undefined;
			location.assign(new URL("./", location.href).toString());
		},
		reload: () => location.reload(),
		update: (targetDate) => {
			const url = updateUrl(location.href, deps.build.date, targetDate);
			if (url) location.replace(url);
		},
		rememberSeat: (seat) => {
			const query = selectedPlayerQuery(location.search, seat);
			history.replaceState(
				null,
				"",
				`${location.pathname}?${query}${location.hash}`,
			);
		},
		forgetSeat: () => {
			history.replaceState(
				null,
				"",
				`${location.pathname}?${sharedQuery(location.search)}${location.hash}`,
			);
		},
	};

	const route = (): void => {
		dispose?.();
		dispose = undefined;
		const target = parseRoute(location.hash);
		const community = parseCommunityRoute(location.hash);
		if (community) {
			if (!corner.isConnected) root.before(corner);
			dispose = showCommunity(root, deps, community, navigation);
			return;
		}
		// The create screen shows the language picker in its own options row.
		if (target.kind === "create") corner.remove();
		else if (!corner.isConnected) root.before(corner);
		switch (target.kind) {
			case "create":
				dispose = showCreate(
					root,
					deps,
					parseBookmark(location.search),
					(key, config, seat, hostBots) => {
						// Keep setup data and the selected seat in the address; replaceState fires no hashchange.
						const query = selectedPlayerQuery(
							bookmarkQuery(config.names, seat, config.botSetup),
							seat,
						);
						const sharedUrl = new URL(deps.pageUrl());
						sharedUrl.search = sharedQuery(query);
						sharedUrl.hash = tableFragment(key);
						const autoCopy = copyToClipboard(sharedUrl.toString());
						history.replaceState(
							null,
							"",
							`${location.pathname}?${query}${tableFragment(key)}`,
						);
						dispose?.();
						dispose = showTable(
							root,
							deps,
							key,
							true,
							navigation,
							parseSelectedPlayer(location.search),
							undefined,
							autoCopy,
							hostBots,
						);
					},
				);
				return;
			case "table": {
				dispose = showTable(
					root,
					deps,
					target.key,
					false,
					navigation,
					parseSelectedPlayer(location.search),
					parseRoomSetup(location.search),
				);
				return;
			}
			case "invalid":
				dispose = showLinkProblem(
					root,
					navigation,
					deps.t("This link is not valid. Check that you copied all of it."),
					deps.t,
				);
				return;
		}
	};

	window.addEventListener("hashchange", route);
	route();
}
