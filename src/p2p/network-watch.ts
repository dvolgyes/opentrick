import { RESUME_COALESCE_MS, RESUME_HIDDEN_MS } from "./limits";

/** The browser objects whose events show a network change; the unit tests pass plain event targets. */
export interface NetworkEventSources {
	readonly window: EventTarget;
	readonly document: EventTarget & {
		readonly visibilityState: DocumentVisibilityState;
	};
	/** `navigator.connection`, where the browser has the Network Information API. */
	readonly connection: EventTarget | undefined;
	/** The wall clock: unlike `performance.now()`, it also counts the time that the device sleeps. */
	readonly wall: () => number;
}

/**
 * Calls `onChange` at each network change until the returned function runs: the page comes online again, the
 * connection type changes (Wi-Fi to mobile data and back), or the page resumes. A page resumes when it is shown
 * after RESUME_HIDDEN_MS or more hidden, when the browser restores it from the back-forward cache, or after a freeze;
 * a phone can sleep or change its network in that time, and the relay sockets can be dead. One resume can send
 * several of these events, so a resume within RESUME_COALESCE_MS of the last one is not reported again. A page
 * shown after a shorter time hidden calls `onShown` instead.
 */
export function watchNetworkChanges(
	sources: NetworkEventSources,
	onChange: () => void,
	onShown: () => void = () => {},
): () => void {
	const { window, document, connection, wall } = sources;
	let hiddenAt: number | undefined =
		document.visibilityState === "hidden" ? wall() : undefined;
	let resumedAt = Number.NEGATIVE_INFINITY;
	const resumed = () => {
		const now = wall();
		if (now - resumedAt < RESUME_COALESCE_MS) return;
		resumedAt = now;
		onChange();
	};
	const onVisibility = () => {
		if (document.visibilityState === "hidden") {
			hiddenAt ??= wall();
			return;
		}
		const since = hiddenAt;
		hiddenAt = undefined;
		if (since === undefined) return;
		if (wall() - since >= RESUME_HIDDEN_MS) resumed();
		else onShown();
	};
	const onPageShow = (event: Event) => {
		if ((event as PageTransitionEvent).persisted) resumed();
	};
	window.addEventListener("online", onChange);
	connection?.addEventListener("change", onChange);
	document.addEventListener("visibilitychange", onVisibility);
	window.addEventListener("pageshow", onPageShow);
	document.addEventListener("resume", resumed);
	return () => {
		window.removeEventListener("online", onChange);
		connection?.removeEventListener("change", onChange);
		document.removeEventListener("visibilitychange", onVisibility);
		window.removeEventListener("pageshow", onPageShow);
		document.removeEventListener("resume", resumed);
	};
}
