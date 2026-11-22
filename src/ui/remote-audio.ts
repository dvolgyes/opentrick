import type { RemoteView } from "../call/call";
import type { Translate } from "../i18n";
import type { Seat } from "../protocol";
import { button, el } from "./dom";

/**
 * One audio element per remote seat (handover §4). An element plays a track only while the call view gives it
 * one, so turning Hear others off or leaving the call silences it at once. The elements outlive the table's
 * re-rendering, so playback never restarts because the game changed.
 */

export interface RemoteAudio {
	readonly element: HTMLElement;
	/** Mount outside the hidden audio container, in visible room controls. */
	readonly hearButton: HTMLButtonElement;
	render(remotes: readonly RemoteView[]): void;
	/** The room screen is gone: stop all playback. */
	detach(): void;
}

interface Player {
	readonly node: HTMLAudioElement;
	track: MediaStreamTrack | undefined;
	revision: number;
	unwatch: (() => void) | undefined;
}

/** `data-play` says what playback does: off, playing, blocked (autoplay rule) or failed. */
export function play(node: HTMLMediaElement): void {
	node.play().then(
		() => {
			node.dataset.play = "playing";
		},
		(error: unknown) => {
			if (!(error instanceof DOMException)) throw error;
			// A newer source or a pause replaced this attempt.
			if (error.name === "AbortError") return;
			node.dataset.play =
				error.name === "NotAllowedError" ? "blocked" : "failed";
		},
	);
}

export function remoteAudio(t: Translate): RemoteAudio {
	const element = el("div", {
		className: "remote-audio",
		attrs: { "aria-hidden": "true" },
	});
	const players = new Map<Seat, Player>();
	const hearButton = button(t("Tap to hear the call"), resume, {
		className: "remote-audio-hear",
	});
	hearButton.hidden = true;

	function audible(track: MediaStreamTrack | undefined): boolean {
		return track?.readyState === "live" && !track.muted && track.enabled;
	}

	function blocked(player: Player): boolean {
		return player.node.dataset.play === "blocked" && audible(player.track);
	}

	function updateButton(): void {
		for (const player of players.values()) {
			if (blocked(player)) {
				hearButton.hidden = false;
				return;
			}
		}
		hearButton.hidden = true;
	}

	function start(player: Player): void {
		const { node } = player;
		const revision = ++player.revision;
		node.dataset.play = "starting";
		void node.play().then(
			() => {
				if (player.revision !== revision) return;
				node.dataset.play = "playing";
				updateButton();
			},
			(error: unknown) => {
				if (player.revision !== revision) return;
				node.dataset.play =
					error instanceof DOMException && error.name === "NotAllowedError"
						? "blocked"
						: "failed";
				updateButton();
			},
		);
	}

	function resume(): void {
		for (const player of players.values()) {
			if (blocked(player)) start(player);
		}
		updateButton();
	}

	function recoverInterrupted(player: Player): void {
		const { node, track } = player;
		if (
			document.visibilityState === "visible" &&
			node.dataset.play === "playing" &&
			node.paused &&
			audible(track)
		) {
			start(player);
		}
	}

	function onVisibility(): void {
		for (const player of players.values()) recoverInterrupted(player);
	}
	document.addEventListener("visibilitychange", onVisibility);

	function playerFor(seat: Seat): Player {
		const known = players.get(seat);
		if (known !== undefined) return known;
		const node = el("audio", {
			attrs: { "data-seat": seat, "data-testid": `audio-${seat}` },
		});
		node.dataset.play = "off";
		const player: Player = {
			node,
			track: undefined,
			revision: 0,
			unwatch: undefined,
		};
		node.addEventListener("pause", () => recoverInterrupted(player));
		element.append(node);
		players.set(seat, player);
		return player;
	}

	function setTrack(player: Player, next: MediaStreamTrack | undefined): void {
		const track = next?.readyState === "ended" ? undefined : next;
		if (player.track === track) return;
		player.unwatch?.();
		player.unwatch = undefined;
		++player.revision;
		player.track = track;
		const { node } = player;
		if (track === undefined) {
			node.dataset.play = "off";
			node.srcObject = null;
			return;
		}

		node.dataset.play = "waiting";
		node.srcObject = new MediaStream([track]);
		const onUnmute = (): void => {
			if (node.dataset.play === "waiting" && audible(track)) start(player);
			else recoverInterrupted(player);
			updateButton();
		};
		const onEnded = (): void => {
			setTrack(player, undefined);
			updateButton();
		};
		track.addEventListener("mute", updateButton);
		track.addEventListener("unmute", onUnmute);
		track.addEventListener("ended", onEnded);
		player.unwatch = () => {
			track.removeEventListener("mute", updateButton);
			track.removeEventListener("unmute", onUnmute);
			track.removeEventListener("ended", onEnded);
		};
		if (audible(track)) start(player);
	}

	function render(remotes: readonly RemoteView[]): void {
		for (const remote of remotes)
			setTrack(playerFor(remote.seat), remote.audio);
		for (const [seat, player] of players) {
			if (!remotes.some((remote) => remote.seat === seat))
				setTrack(player, undefined);
		}
		updateButton();
	}

	function detach(): void {
		document.removeEventListener("visibilitychange", onVisibility);
		for (const player of players.values()) setTrack(player, undefined);
		players.clear();
		element.replaceChildren();
		updateButton();
	}

	return { element, hearButton, render, detach };
}
