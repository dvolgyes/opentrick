import {
	isObject,
	isPlayerName,
	type RoomConfig,
	SEATS,
	type Seat,
} from "./protocol";

/** A display name is never an identity or an authorization credential. */
export function playerName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const name = value.trim().normalize("NFC");
	return isPlayerName(name) ? name : undefined;
}

export function unnamedPlayer(name: string): boolean {
	return name.trim() === "" || name.trim().toLowerCase() === "player";
}

export interface PlayerProfile {
	readonly name: string;
	readonly askOnEntry: boolean;
	readonly rev: number;
}

export type PlayerProfiles = Readonly<Record<Seat, PlayerProfile>>;

export function initialPlayers(config: RoomConfig): PlayerProfiles {
	return Object.fromEntries(
		SEATS.map((seat) => [
			seat,
			{
				name: unnamedPlayer(config.names[seat]) ? "player" : config.names[seat],
				askOnEntry: unnamedPlayer(config.names[seat]),
				rev: 0,
			},
		]),
	) as unknown as PlayerProfiles;
}

export function parsePlayers(value: unknown): PlayerProfiles | undefined {
	if (!isObject(value)) return undefined;
	const profiles: Partial<Record<Seat, PlayerProfile>> = {};
	for (const seat of SEATS) {
		const item = value[seat];
		if (
			!isObject(item) ||
			typeof item.name !== "string" ||
			playerName(item.name) !== item.name ||
			typeof item.askOnEntry !== "boolean" ||
			typeof item.rev !== "number" ||
			!Number.isSafeInteger(item.rev) ||
			item.rev < 0
		)
			return undefined;
		profiles[seat] = {
			name: item.name as string,
			askOnEntry: item.askOnEntry,
			rev: item.rev,
		};
	}
	return profiles as PlayerProfiles;
}

export function playersFor(table: {
	readonly config: RoomConfig;
	readonly players?: PlayerProfiles;
}): PlayerProfiles {
	return table.players ?? initialPlayers(table.config);
}

/** One projection supplies current labels to the game, chat, call and UI. */
export function playerConfig(table: {
	readonly config: RoomConfig;
	readonly players?: PlayerProfiles;
}): RoomConfig {
	const players = playersFor(table);
	return {
		...table.config,
		names: Object.fromEntries(
			SEATS.map((seat) => [seat, players[seat].name]),
		) as Record<Seat, string>,
	};
}
