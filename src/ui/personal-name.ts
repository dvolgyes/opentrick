import { playerName, unnamedPlayer } from "../players";
import type { MaybeStorage } from "../session";

const NAME_KEY = "opentrick.player-name";

/** A personal preference with no application expiry; room renames never write it. */
export function readPersonalName(storage: MaybeStorage): string {
	const name = playerName(storage?.getItem(NAME_KEY));
	return name && !unnamedPlayer(name) ? name : "";
}

export function savePersonalName(
	storage: MaybeStorage,
	value: string,
): boolean {
	const name = playerName(value);
	if (!storage || !name || unnamedPlayer(name)) return false;
	storage.setItem(NAME_KEY, name);
	return storage.getItem(NAME_KEY) === name;
}
