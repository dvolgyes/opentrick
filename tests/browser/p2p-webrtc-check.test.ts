import { afterEach, describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { webRtcCheck } from "../../src/p2p/webrtc-check";

declare module "vitest/browser" {
	interface BrowserCommands {
		startStunServer(): Promise<number>;
		stopStunServer(port: number): Promise<void>;
	}
}

// The WebRTC check in real Chrome, with the fake STUN server in Node (vite.config.ts).

const ports: number[] = [];

afterEach(async () => {
	for (const port of ports.splice(0)) await commands.stopStunServer(port);
});

describe("webRtcCheck in Chrome", () => {
	it("sends a message over a data channel inside the page and lists the local candidate types", async () => {
		const port = await commands.startStunServer();
		ports.push(port);
		const report = await webRtcCheck(RTCPeerConnection, {
			iceServers: [{ urls: `stun:127.0.0.1:${port}` }],
		})();
		expect(report).toMatchObject({ kind: "checked", channel: "open" });
		if (report.kind !== "checked") return;
		expect(report.candidates.some((label) => label.startsWith("host "))).toBe(
			true,
		);
		expect(report.candidates).toContain("srflx IPv4");
		// Only the labels, never an address.
		for (const label of report.candidates)
			expect(label).toMatch(
				/^(host|srflx|prflx|relay) (IPv4|IPv6|mDNS)( TCP)?$/,
			);
	}, 15_000);
});
