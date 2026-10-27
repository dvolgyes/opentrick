import type { Board } from "../bridge/engine";
import { BotRequestAbortedError } from "./errors";

export interface BotTiming {
	readonly botCardDelayMs: number;
	readonly botBidDelayMs: number;
	readonly auctionPauseMs: number;
}

export const DEFAULT_BOT_TIMING: BotTiming = {
	botCardDelayMs: 1000,
	botBidDelayMs: 3000,
	auctionPauseMs: 3000,
};

/** The readability floors also apply to stored values and callers outside the settings dialog. */
export function isBotTimingMs(
	value: unknown,
	minimum: number,
): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= minimum &&
		value <= 60_000
	);
}

export function botTiming(settings: Partial<BotTiming> = {}): BotTiming {
	const timing: BotTiming = {
		botCardDelayMs:
			settings.botCardDelayMs ?? DEFAULT_BOT_TIMING.botCardDelayMs,
		botBidDelayMs: settings.botBidDelayMs ?? DEFAULT_BOT_TIMING.botBidDelayMs,
		auctionPauseMs:
			settings.auctionPauseMs ?? DEFAULT_BOT_TIMING.auctionPauseMs,
	};
	for (const key of Object.keys(DEFAULT_BOT_TIMING) as (keyof BotTiming)[]) {
		if (!isBotTimingMs(timing[key], DEFAULT_BOT_TIMING[key]))
			throw new Error(
				`${key} must be an integer from ${DEFAULT_BOT_TIMING[key]} to 60000 milliseconds`,
			);
	}
	return timing;
}

export function minimumActionMs(
	board: Board,
	kind: "call" | "play",
	timing: BotTiming,
): number {
	if (kind === "call") return timing.botBidDelayMs;
	return board.cards.length === 0
		? Math.max(timing.botCardDelayMs, timing.auctionPauseMs)
		: timing.botCardDelayMs;
}

/** Calculation time counts toward the minimum; an aborted turn must not leave a delayed action behind. */
export function waitForMinimum(
	startedAt: number,
	minimumMs: number,
	signal: AbortSignal,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new BotRequestAbortedError());
			return;
		}
		const remaining = minimumMs - (performance.now() - startedAt);
		if (remaining <= 0) {
			resolve();
			return;
		}
		const abort = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			reject(new BotRequestAbortedError());
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, Math.ceil(remaining));
		signal.addEventListener("abort", abort, { once: true });
	});
}
