import { describe, expect, it } from "vitest";
import { communityGameFragment, partyFragment } from "../../src/community/link";
import { invitationUrl } from "../../src/ui/invitation-url";

describe("pasted invitations", () => {
	const page = "https://bridge.example/project/";
	const key = "AAAAAAAAAAAAAAAAAAAAAA";
	it("keeps the complete existing table link inside the deployment", () => {
		const link = `${page}create/?h=S#k=${key}`;
		expect(invitationUrl(link, page)).toBe(link);
	});
	it("accepts the existing community invitation and recovery fragments", () => {
		for (const fragment of [
			partyFragment(key, "member_aaa", ["N", "S"]),
			communityGameFragment(key, "member_aaa", "S"),
		]) {
			const link = `${page}create/${fragment}`;
			expect(invitationUrl(link, page)).toBe(link);
		}
	});
	it("rejects invalid fragments, other origins, credentials, paths, and executable URLs", () => {
		for (const link of [
			`${page}create/#k=invalid`,
			`https://evil.example/project/create/#k=${key}`,
			`https://user@bridge.example/project/create/#k=${key}`,
			`https://bridge.example/other/create/#k=${key}`,
			"javascript:alert(1)",
			`${page}create/#k=${key}${"x".repeat(8192)}`,
		])
			expect(invitationUrl(link, page)).toBeUndefined();
	});
});
