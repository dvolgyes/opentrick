import { isObject } from "../protocol";
import { type Group, validId } from "./formation";
import { parseGroup } from "./journal";

export const OFFER_TTL_MS = 20_000;
export const REFRESH_MS = 5_000;
const MAX_ADVERTISEMENTS = 12;

export interface Advertisement {
	readonly k: "offer";
	readonly member: string;
	readonly groupId: string;
	readonly revision: number;
	readonly sequence: number;
	readonly group?: Group;
}

export interface ListedGroup {
	readonly group: Group;
	readonly peers: ReadonlyMap<string, string>;
}

/** Each browser endorses only its own membership. A host alone cannot make its party appear ready. */
export class Directory {
	readonly #offers = new Map<string, { offer: Advertisement; at: number }>();

	receive(peer: string, value: unknown, now: number): boolean {
		this.#expire(now);
		if (
			!isObject(value) ||
			value.k !== "offer" ||
			!validId(value.member) ||
			!validId(value.groupId) ||
			!Number.isSafeInteger(value.revision) ||
			Number(value.revision) < 0 ||
			!Number.isSafeInteger(value.sequence) ||
			Number(value.sequence) < 0
		)
			return false;
		const group =
			value.group === undefined ? undefined : parseGroup(value.group);
		if (
			value.group !== undefined &&
			(!group ||
				group.id !== value.groupId ||
				group.revision !== value.revision ||
				group.host !== value.member)
		)
			return false;
		const previous = this.#offers.get(peer);
		if (previous && previous.offer.sequence >= Number(value.sequence))
			return false;
		if (!previous && this.#offers.size >= MAX_ADVERTISEMENTS) return false;
		this.#offers.set(peer, {
			at: now,
			offer: {
				k: "offer",
				member: value.member,
				groupId: value.groupId,
				revision: Number(value.revision),
				sequence: Number(value.sequence),
				...(group ? { group } : {}),
			},
		});
		return true;
	}

	remove(peer: string): void {
		this.#offers.delete(peer);
	}

	groups(now: number): readonly ListedGroup[] {
		this.#expire(now);
		const listed: ListedGroup[] = [];
		for (const { offer } of this.#offers.values()) {
			const group = offer.group;
			if (!group || group.members.length === 4) continue;
			const peers = new Map<string, string>();
			for (const [peer, entry] of this.#offers) {
				const endorsement = entry.offer;
				if (
					endorsement.groupId !== group.id ||
					endorsement.revision !== group.revision
				)
					continue;
				if (peers.has(endorsement.member)) {
					peers.clear();
					break;
				}
				peers.set(endorsement.member, peer);
			}
			if (
				peers.size === group.members.length &&
				group.members.every((member) => peers.has(member.id))
			)
				listed.push({ group, peers });
		}
		return listed;
	}

	#expire(now: number): void {
		for (const [peer, entry] of this.#offers)
			if (now - entry.at >= OFFER_TTL_MS) this.#offers.delete(peer);
	}
}
