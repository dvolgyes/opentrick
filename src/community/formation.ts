import { isPlayerName, isSeat, SEATS, type Seat } from "../protocol";

/** A party keeps its relative seating through every merge. IDs identify searches, not people. */
export interface Member {
	readonly id: string;
	readonly name: string;
	readonly seat: Seat;
	readonly recruitment?: "invited" | "online";
}

export interface Group {
	readonly id: string;
	readonly revision: number;
	readonly host: string;
	readonly members: readonly Member[];
	/** Unoccupied seats and their permitted occupants. Omitted only in saved legacy groups. */
	readonly open?: OpenSeats;
}

export type SeatChoice = "bot" | "online" | "both";
export type OpenSeats = Readonly<Partial<Record<Seat, SeatChoice>>>;

export function validOpen(value: unknown): value is OpenSeats {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.entries(value).every(
			([seat, choice]) =>
				isSeat(seat) && ["bot", "online", "both"].includes(choice),
		)
	);
}

export function openSeats(group: Group): OpenSeats {
	return (
		group.open ??
		Object.fromEntries(
			SEATS.filter(
				(seat) => !group.members.some((member) => member.seat === seat),
			).map((seat) => [seat, "both"]),
		)
	);
}

export function permits(
	choice: SeatChoice | undefined,
	kind: "bot" | "online",
): boolean {
	return choice === kind || choice === "both";
}

export interface Merge {
	readonly id: string;
	readonly destination: Group;
	readonly source: Group;
	readonly result: Group;
}

export const MAX_WAIT_MS = 60 * 60 * 1000;

export interface BotConsent {
	readonly allow: boolean;
	readonly waitMs: number;
	/** Accumulated search time on this browser's monotonic clock. Never a remote wall-clock deadline. */
	readonly waitedMs: number;
}

export function validId(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

export function validGroup(group: Group): boolean {
	return (
		validId(group.id) &&
		Number.isSafeInteger(group.revision) &&
		group.revision >= 0 &&
		group.revision < Number.MAX_SAFE_INTEGER &&
		group.members.length >= 1 &&
		group.members.length <= 4 &&
		(group.open === undefined ||
			(validOpen(group.open) &&
				group.members.every(
					(member) => group.open?.[member.seat] === undefined,
				))) &&
		group.members.some((member) => member.id === group.host) &&
		new Set(group.members.map((member) => member.id)).size ===
			group.members.length &&
		new Set(group.members.map((member) => member.seat)).size ===
			group.members.length &&
		group.members.every(
			(member) =>
				validId(member.id) &&
				isPlayerName(member.name) &&
				isSeat(member.seat) &&
				(member.recruitment === undefined ||
					member.recruitment === "invited" ||
					member.recruitment === "online"),
		)
	);
}

/** Destination is independent of which host proposed first. Prefer moving fewer browsers. */
export function destinationFirst(a: Group, b: Group): readonly [Group, Group] {
	return a.members.length > b.members.length ||
		(a.members.length === b.members.length && a.id < b.id)
		? [a, b]
		: [b, a];
}

export function rotate(seat: Seat, steps: number): Seat {
	return SEATS[(SEATS.indexOf(seat) + steps) % 4] as Seat;
}

/** Intersect both groups' choices after rotation, including restrictions on incoming humans. */
function combinedOpen(
	destination: Group,
	source: Group,
	steps: number,
): OpenSeats | undefined {
	const left = openSeats(destination);
	const right = openSeats(source);
	const result: Partial<Record<Seat, SeatChoice>> = {};
	for (const seat of SEATS) {
		const sourceSeat = rotate(seat, 4 - steps);
		const occupiedLeft = destination.members.some(
			(member) => member.seat === seat,
		);
		const occupiedRight = source.members.some(
			(member) => member.seat === sourceSeat,
		);
		if (occupiedLeft && occupiedRight) return undefined;
		if (occupiedLeft) {
			if (!permits(right[sourceSeat], "online")) return undefined;
		} else if (occupiedRight) {
			if (!permits(left[seat], "online")) return undefined;
		} else {
			const bot =
				permits(left[seat], "bot") && permits(right[sourceSeat], "bot");
			const online =
				permits(left[seat], "online") && permits(right[sourceSeat], "online");
			if (!bot && !online) return undefined;
			result[seat] = bot && online ? "both" : bot ? "bot" : "online";
		}
	}
	return result;
}

function resultGroup(
	destination: Group,
	source: Group,
	members: readonly Member[],
): Group {
	const initial = source.members[0];
	const placed = members[destination.members.length];
	const steps =
		initial && placed
			? (SEATS.indexOf(placed.seat) - SEATS.indexOf(initial.seat) + 4) % 4
			: 0;
	return {
		...destination,
		revision: destination.revision + 1,
		members,
		...(destination.open !== undefined || source.open !== undefined
			? { open: combinedOpen(destination, source, steps) }
			: {}),
	};
}

/** Every legal rotation, with two solos deliberately made partners. No reflection or re-pairing. */
export function placements(
	destination: Group,
	source: Group,
): readonly (readonly Member[])[] {
	if (
		!validGroup(destination) ||
		!validGroup(source) ||
		destination.id === source.id ||
		destination.members.length + source.members.length > 4 ||
		source.members.some((member) =>
			destination.members.some((other) => other.id === member.id),
		)
	)
		return [];
	const occupied = new Set(destination.members.map((member) => member.seat));
	const first = destination.members[0];
	if (!first) return [];
	const choices: Member[][] = [];
	for (let steps = 0; steps < 4; steps++) {
		const incoming = source.members.map((member) => ({
			...member,
			seat: rotate(member.seat, steps),
		}));
		if (incoming.some((member) => occupied.has(member.seat))) continue;
		if (combinedOpen(destination, source, steps) === undefined) continue;
		choices.push([...destination.members, ...incoming]);
	}
	if (destination.members.length === 1 && source.members.length === 1) {
		const opposite = choices.filter(
			(members) => members[1]?.seat === rotate(first.seat, 2),
		);
		if (opposite.length) return opposite;
	}
	return choices;
}

export function proposeMerge(
	id: string,
	a: Group,
	b: Group,
	choice = 0,
): Merge | undefined {
	if (!validId(id)) return undefined;
	const [destination, source] = destinationFirst(a, b);
	const members = placements(destination, source)[choice];
	if (!members) return undefined;
	return {
		id,
		destination,
		source,
		result: resultGroup(destination, source, members),
	};
}

/** A proposal is untrusted even when both advertised groups were valid. */
export function validMerge(merge: Merge): boolean {
	if (!validId(merge.id) || !validGroup(merge.result)) return false;
	const [destination] = destinationFirst(merge.destination, merge.source);
	return (
		destination.id === merge.destination.id &&
		merge.result.id === destination.id &&
		merge.result.host === destination.host &&
		merge.result.revision === destination.revision + 1 &&
		placements(merge.destination, merge.source).some(
			(members) =>
				sameGroup(
					resultGroup(merge.destination, merge.source, members),
					merge.result,
				) &&
				members.every((member, index) => {
					const actual = merge.result.members[index];
					return (
						actual?.id === member.id &&
						actual.name === member.name &&
						actual.seat === member.seat
					);
				}) &&
				members.length === merge.result.members.length,
		)
	);
}

export function botsReady(
	members: readonly Member[],
	consent: ReadonlyMap<string, BotConsent>,
): boolean {
	return (
		members.length > 0 &&
		members.length < 4 &&
		members.every(({ id }) => {
			const item = consent.get(id);
			return (
				item?.allow === true &&
				Number.isFinite(item.waitMs) &&
				item.waitMs >= 0 &&
				item.waitMs <= MAX_WAIT_MS &&
				Number.isFinite(item.waitedMs) &&
				item.waitedMs >= item.waitMs
			);
		})
	);
}

export function sameGroup(a: Group, b: Group): boolean {
	return (
		a.id === b.id &&
		a.revision === b.revision &&
		a.host === b.host &&
		SEATS.every((seat) => openSeats(a)[seat] === openSeats(b)[seat]) &&
		a.members.length === b.members.length &&
		a.members.every((member, index) => {
			const other = b.members[index];
			return (
				other?.id === member.id &&
				other.name === member.name &&
				other.seat === member.seat &&
				other.recruitment === member.recruitment
			);
		})
	);
}
