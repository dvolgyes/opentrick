import { expect, it } from "vitest";
import { type Group, proposeMerge } from "../../src/community/formation";
import { TransferJournal } from "../../src/community/journal";

const a: Group = {
	id: "group_aaa",
	revision: 0,
	host: "player_aaa",
	members: [{ id: "player_aaa", name: "Alice", seat: "N" }],
};
const b: Group = {
	id: "group_bbb",
	revision: 0,
	host: "player_bbb",
	members: [{ id: "player_bbb", name: "Bob", seat: "N" }],
};
const proposed = proposeMerge("merge_aaa", a, b);
if (!proposed) throw new Error("two solos must fit");
const proposal = proposed;
const key = "AAAAAAAAAAAAAAAAAAAAAA";
function storage() {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			data.set(key, value);
		},
	};
}

it("keeps an exclusive prepared transfer through reload and commits only with every vote", () => {
	const store = storage();
	const first = new TransferJournal(store, a.host);
	expect(first.prepare(proposal, key, a)).toBe(true);
	const restored = new TransferJournal(store, a.host);
	expect(restored.record?.phase).toBe("prepared");
	expect(restored.prepare({ ...proposal, id: "merge_bbb" }, key, a)).toBe(
		false,
	);
	expect(restored.commit(proposal.id, [a.host])).toBe(false);
	expect(restored.commit(proposal.id, [a.host, a.host])).toBe(false);
	expect(restored.commit(proposal.id, [a.host, b.host])).toBe(true);
	expect(new TransferJournal(store, a.host).record?.phase).toBe("committed");
});

it("never turns a recorded vote into a refusal or forgets a committed destination", () => {
	const journal = new TransferJournal(storage(), a.host);
	expect(journal.prepare(proposal, key, a)).toBe(true);
	expect(journal.decline(proposal, a)).toBe(false);
	expect(journal.commit(proposal.id, [a.host, b.host])).toBe(true);
	expect(journal.prepare(proposal, key, a)).toBe(true);
	expect(journal.record?.phase).toBe("committed");
});

it("a durable refusal prevents a later prepare of that proposal", () => {
	const journal = new TransferJournal(storage(), b.host);
	expect(journal.decline(proposal, b)).toBe(true);
	expect(journal.prepare(proposal, key, b)).toBe(false);
});

it("refuses stale membership, forged seating, and failed storage writes", () => {
	const journal = new TransferJournal(storage(), a.host);
	expect(journal.prepare(proposal, key, { ...a, revision: 1 })).toBe(false);
	expect(journal.prepare({ ...proposal, result: b }, key, a)).toBe(false);
	const refused = new TransferJournal(
		{ getItem: () => null, setItem: () => undefined },
		a.host,
	);
	expect(refused.prepare(proposal, key, a)).toBe(false);
	expect(refused.record).toBeUndefined();
});
