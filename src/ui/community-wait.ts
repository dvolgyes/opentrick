import { MAX_WAIT_MS } from "../community/formation";
import type { MaybeStorage } from "../session";

const KEY = "opentrick.community.wait-minutes";
export const DEFAULT_WAIT_MINUTES = 2;

export function parseWaitMinutes(
	value: string | null | undefined,
): number | undefined {
	const text = value?.trim();
	if (!text || !/^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(text))
		return undefined;
	const minutes = Number(text);
	return Number.isFinite(minutes) &&
		minutes >= 0 &&
		minutes <= MAX_WAIT_MS / 60_000
		? minutes
		: undefined;
}

export function readWaitMinutes(storage: MaybeStorage): number {
	return parseWaitMinutes(storage?.getItem(KEY)) ?? DEFAULT_WAIT_MINUTES;
}

export function saveWaitMinutes(
	storage: MaybeStorage,
	minutes: number | undefined,
): void {
	if (minutes === undefined) storage?.removeItem(KEY);
	else storage?.setItem(KEY, String(minutes));
}
