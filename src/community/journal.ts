import { isTableKey } from "../p2p/link";
import { isObject } from "../protocol";
import {
	type Group,
	type Merge,
	sameGroup,
	validGroup,
	validMerge,
} from "./formation";

export interface TransferRecord {
	readonly merge: Merge;
	readonly phase: "prepared" | "committed" | "declined" | "aborted";
	readonly destinationKey?: string;
	readonly votes: readonly string[];
}

type Store = Pick<Storage, "getItem" | "setItem">;
const MAX_RECORDS = 64;

/** Only structured, bounded data may enter either storage or a private formation channel. */
export function parseGroup(value: unknown): Group | undefined {
	if (
		!isObject(value) ||
		!Array.isArray(value.members) ||
		value.members.length > 4
	)
		return undefined;
	const members = value.members.map((member: unknown) => {
		if (!isObject(member)) return undefined;
		return { id: member.id, name: member.name, seat: member.seat };
	});
	if (members.some((member) => member === undefined)) return undefined;
	const group = {
		id: value.id,
		revision: value.revision,
		host: value.host,
		members,
	} as Group;
	return validGroup(group) ? group : undefined;
}

export function parseMerge(value: unknown): Merge | undefined {
	if (!isObject(value)) return undefined;
	const destination = parseGroup(value.destination);
	const source = parseGroup(value.source);
	const result = parseGroup(value.result);
	if (!destination || !source || !result || typeof value.id !== "string")
		return undefined;
	const merge = { id: value.id, destination, source, result };
	return validMerge(merge) ? merge : undefined;
}

/**
 * A prepare is a durable vote for exactly one destination. It cannot time out into another search.
 * Every participant can reconstruct commitment from all votes, without the original coordinator.
 * A refusal is allowed only before this participant votes; that refusal proves an all-vote commit impossible.
 * The transport must authenticate each vote/refusal against the proposal's participant connections.
 * These records are deliberately outside the bridge log, whose entries can roll back during host election.
 */
export class TransferJournal {
	readonly #store: Store;
	readonly #key: string;
	readonly #member: string;
	#records: readonly TransferRecord[] = [];
	#valid = true;

	constructor(store: Store, member: string) {
		this.#store = store;
		this.#member = member;
		this.#key = `opentrick.community.transfers.${member}`;
		const text = store.getItem(this.#key);
		if (text === null) return;
		this.#valid = false;
		if (text.length > 128 * 1024) return;
		let value: unknown;
		try {
			value = JSON.parse(text);
		} catch (error) {
			if (error instanceof SyntaxError) return;
			throw error;
		}
		if (!Array.isArray(value) || value.length > MAX_RECORDS) return;
		const records: TransferRecord[] = [];
		for (const item of value) {
			if (!isObject(item)) return;
			const merge = parseMerge(item.merge);
			const phase = item.phase;
			if (
				!merge?.result.members.some((row) => row.id === member) ||
				!["prepared", "committed", "declined", "aborted"].includes(
					String(phase),
				) ||
				!Array.isArray(item.votes) ||
				item.votes.length > 4 ||
				!item.votes.every(
					(id) =>
						typeof id === "string" &&
						merge.result.members.some((row) => row.id === id),
				)
			)
				return;
			if (
				(phase === "prepared" || phase === "committed") &&
				!isTableKey(item.destinationKey)
			)
				return;
			const record = {
				merge,
				phase,
				votes: [...new Set(item.votes)],
				...(isTableKey(item.destinationKey)
					? { destinationKey: item.destinationKey }
					: {}),
			} as TransferRecord;
			if (phase === "committed" && !this.#complete(record)) return;
			records.push(record);
		}
		if (
			new Set(records.map((record) => record.merge.id)).size !==
				records.length ||
			records.filter((record) => record.phase === "prepared").length > 1
		)
			return;
		this.#records = records;
		this.#valid = true;
	}

	get valid(): boolean {
		return this.#valid;
	}
	get record(): TransferRecord | undefined {
		return this.#records.at(-1);
	}
	get records(): readonly TransferRecord[] {
		return this.#records;
	}

	prepare(merge: Merge, destinationKey: string, current: Group): boolean {
		if (!this.#matches(merge, current) || !isTableKey(destinationKey))
			return false;
		const known = this.#records.find((record) => record.merge.id === merge.id);
		if (known)
			return (
				(known.phase === "prepared" || known.phase === "committed") &&
				JSON.stringify(known.merge) === JSON.stringify(merge) &&
				known.destinationKey === destinationKey
			);
		if (!this.#available(current)) return false;
		return this.#save([
			...this.#records,
			{ merge, destinationKey, phase: "prepared", votes: [this.#member] },
		]);
	}

	decline(merge: Merge, current: Group): boolean {
		if (!this.#matches(merge, current)) return false;
		const known = this.#records.find((record) => record.merge.id === merge.id);
		if (known) return known.phase === "declined";
		if (!this.#available(current)) return false;
		return this.#save([
			...this.#records,
			{ merge, phase: "declined", votes: [] },
		]);
	}

	/** Called only for a refusal received from that participant, before it issued a prepare vote. */
	abortAfterRefusal(id: string, member: string): boolean {
		const record = this.record;
		if (
			!record ||
			record.merge.id !== id ||
			record.phase !== "prepared" ||
			member === this.#member ||
			!record.merge.result.members.some((row) => row.id === member)
		)
			return false;
		return this.#save([
			...this.#records.slice(0, -1),
			{ ...record, phase: "aborted" },
		]);
	}

	commit(id: string, votes: readonly string[]): boolean {
		const record = this.record;
		if (
			!record ||
			record.merge.id !== id ||
			(record.phase !== "prepared" && record.phase !== "committed")
		)
			return false;
		const committed: TransferRecord = {
			...record,
			phase: "committed",
			votes: [...new Set(votes)],
		};
		if (!this.#complete(committed)) return false;
		return this.#save([...this.#records.slice(0, -1), committed]);
	}

	#matches(merge: Merge, current: Group): boolean {
		return (
			this.#valid &&
			validMerge(merge) &&
			current.members.some((row) => row.id === this.#member) &&
			(sameGroup(current, merge.source) ||
				sameGroup(current, merge.destination))
		);
	}

	#available(current: Group): boolean {
		const last = this.record;
		return (
			!last ||
			last.phase === "declined" ||
			last.phase === "aborted" ||
			(last.phase === "committed" && sameGroup(current, last.merge.result))
		);
	}

	#complete(record: TransferRecord): boolean {
		return (
			record.votes.length === record.merge.result.members.length &&
			record.merge.result.members.every((member) =>
				record.votes.includes(member.id),
			)
		);
	}

	#save(records: readonly TransferRecord[]): boolean {
		if (!this.#valid || records.length > MAX_RECORDS) return false;
		const text = JSON.stringify(records);
		this.#store.setItem(this.#key, text);
		if (this.#store.getItem(this.#key) !== text) return false;
		this.#records = records;
		return true;
	}
}
