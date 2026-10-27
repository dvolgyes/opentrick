import { expect, it } from "vitest";
import { Directory, OFFER_TTL_MS } from "../../src/community/directory";
import type { Group } from "../../src/community/formation";

const group: Group = {
	id: "group_aaa",
	revision: 1,
	host: "member_aaa",
	members: [
		{ id: "member_aaa", name: "Alice", seat: "N" },
		{ id: "member_bbb", name: "Bob", seat: "S" },
	],
};
const advertisement = {
	k: "offer",
	member: group.host,
	groupId: group.id,
	revision: 1,
	sequence: 1,
	group,
};
it("lists a party only when every member independently endorses the same revision", () => {
	const directory = new Directory();
	expect(directory.receive("peer-a", advertisement, 0)).toBe(true);
	expect(directory.groups(0)).toEqual([]);
	directory.receive(
		"peer-b",
		{ ...advertisement, member: "member_bbb", group: undefined },
		0,
	);
	expect(directory.groups(0).map((entry) => entry.group)).toEqual([group]);
	directory.receive(
		"peer-b",
		{
			...advertisement,
			member: "member_bbb",
			group: undefined,
			revision: 0,
			sequence: 2,
		},
		10,
	);
	expect(directory.groups(10)).toEqual([]);
});
it("expires silence, rejects replay without refreshing freshness, and withdraws on departure", () => {
	const directory = new Directory();
	directory.receive("peer-a", advertisement, 0);
	directory.receive(
		"peer-b",
		{ ...advertisement, member: "member_bbb", group: undefined },
		0,
	);
	expect(directory.receive("peer-a", advertisement, OFFER_TTL_MS - 1)).toBe(
		false,
	);
	expect(directory.groups(OFFER_TTL_MS)).toEqual([]);
	directory.receive("peer-a", advertisement, OFFER_TTL_MS);
	directory.receive(
		"peer-b",
		{ ...advertisement, member: "member_bbb", group: undefined },
		OFFER_TTL_MS,
	);
	directory.remove("peer-b");
	expect(directory.groups(OFFER_TTL_MS)).toEqual([]);
});
