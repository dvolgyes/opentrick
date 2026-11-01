import { BridgeRain } from "./bridge-rain";
import { el } from "./dom";

/** Off: no scene, or a frozen one that is not shown. Still: the frozen scene. Moving: the bot's turn. */
export type BotAnimationState = "off" | "still" | "moving";

/** The animation of one bot tile, in place of the bot image. */
export interface BotAnimation {
	readonly element: HTMLElement;
	/** The scene could not start, so the owner shows the bot image. */
	failed(): boolean;
	/** The first state other than off mounts the scene; the scene keeps its positions between the turns. */
	show(state: BotAnimationState): void;
	destroy(): void;
}

/** `onFailure` runs once if the scene cannot start, for example without its font. */
export function botAnimation(onFailure: () => void): BotAnimation {
	const element = el("span", {
		className: "bot-animation",
		attrs: { "data-testid": "bot-animation" },
	});
	let rain: BridgeRain | undefined;
	let starting = false;
	let failed = false;
	let destroyed = false;
	let wanted: BotAnimationState = "off";

	function apply(): void {
		rain?.setMode(wanted === "moving" ? "thinking" : "idle");
		element.dataset.state = rain === undefined ? "off" : wanted;
	}

	return {
		element,
		failed: () => failed,
		show(state) {
			wanted = state;
			if (state !== "off" && rain === undefined && !starting && !failed) {
				starting = true;
				// The font loads first, and the turn can change meanwhile: the scene takes the last state.
				BridgeRain.create(element, { density: 12 }).then(
					(scene) => {
						if (destroyed) {
							scene.destroy();
							return;
						}
						rain = scene;
						apply();
					},
					(error: unknown) => {
						failed = true;
						console.warn("The bot animation could not start.", error);
						if (!destroyed) onFailure();
					},
				);
			}
			apply();
		},
		destroy() {
			destroyed = true;
			rain?.destroy();
			rain = undefined;
		},
	};
}
