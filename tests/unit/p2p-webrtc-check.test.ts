import { describe, expect, it } from "vitest";
import { candidateLabel, webRtcCheck } from "../../src/p2p/webrtc-check";

describe("the WebRTC check", () => {
	it("reports a browser without WebRTC, as on an iPhone in Lockdown Mode", async () => {
		await expect(webRtcCheck(undefined, {})()).resolves.toEqual({
			kind: "missing",
		});
	});

	it("labels a candidate by its type, address family and protocol, without the address", () => {
		expect(
			candidateLabel(
				"candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host generation 0",
			),
		).toBe("host IPv4");
		expect(
			candidateLabel(
				"candidate:2 1 UDP 1686052607 2001:db8::7 61000 typ srflx raddr :: rport 0",
			),
		).toBe("srflx IPv6");
		expect(
			candidateLabel(
				"candidate:3 1 udp 2122260223 4f1d2c3e-1111-2222-3333-444455556666.local 54321 typ host",
			),
		).toBe("host mDNS");
		expect(
			candidateLabel(
				"a=candidate:4 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active",
			),
		).toBe("host IPv4 TCP");
		expect(candidateLabel("")).toBeUndefined();
	});
});
