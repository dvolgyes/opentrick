import { deriveHolder } from "../p2p/keys";
import { isBotName, type RoomConfig, SEATS, type Seat } from "../protocol";

export interface BotSeatClaim {
	readonly seat: Seat;
	readonly holder: string;
	readonly id: string;
}

export function botSeats(config: RoomConfig): Seat[] {
	return SEATS.filter((seat) =>
		config.botSetup
			? config.botSetup.seats.includes(seat)
			: isBotName(config.names[seat]),
	);
}

/** The seat of a solo setup: the only seat that the setup does not give to a bot. */
export function soloSeat(config: RoomConfig): Seat | undefined {
	const bots = botSeats(config);
	const people = SEATS.filter((seat) => !bots.includes(seat));
	return people.length === 1 ? people[0] : undefined;
}

export function botSeatHolder(tableId: string, seat: Seat): Promise<string> {
	return deriveHolder(tableId, `opentrick|host-bot|${seat}`);
}

export async function botSeatClaims(
	tableId: string,
	config: RoomConfig,
	newId: () => string,
	exclude?: Seat,
): Promise<BotSeatClaim[]> {
	return Promise.all(
		botSeats(config)
			.filter((seat) => seat !== exclude)
			.map(async (seat) => ({
				seat,
				holder: await botSeatHolder(tableId, seat),
				id: newId(),
			})),
	);
}
