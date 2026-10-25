import { afterEach, describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import type { MeshHandlers } from "../../src/p2p/mesh";
import { relaySockets } from "../../src/p2p/signaling";
import { stunProbe } from "../../src/p2p/stun-probe";
import { trysteroMesh } from "../../src/p2p/trystero";

declare module "vitest/browser" {
	interface BrowserCommands {
		startStunServer(): Promise<number>;
		stopStunServer(port: number): Promise<void>;
	}
}

// The discovery evidence in real Chrome: the STUN probe against a fake STUN server in Node (vite.config.ts), and the
// real Trystero join with the trackers and the Nostr relays turned off.

const ports: number[] = [];

afterEach(async () => {
	for (const port of ports.splice(0)) await commands.stopStunServer(port);
});

describe("stunProbe in Chrome", () => {
	it("hears the answer of a STUN server", async () => {
		const port = await commands.startStunServer();
		ports.push(port);
		await expect(
			stunProbe(RTCPeerConnection)(`stun:127.0.0.1:${port}`),
		).resolves.toBe("answered");
	});

	it("reports no answer from a port where no STUN server listens", async () => {
		await expect(
			stunProbe(RTCPeerConnection)("stun:127.0.0.1:9"),
		).resolves.toBe("no-answer");
	}, 10_000);
});

const handlers: MeshHandlers = {
	join: () => {},
	leave: () => {},
	ctl: () => {},
	log: () => {},
	call: () => {},
	change: () => {},
};

describe("the mesh with trackers, Nostr relays and STUN turned off", () => {
	it("opens no relay socket, not even to Trystero's own trackers", async () => {
		const opened: string[] = [];
		const Native = globalThis.WebSocket;
		globalThis.WebSocket = class extends Native {
			constructor(url: string | URL, protocols?: string | string[]) {
				super(url, protocols);
				opened.push(String(url));
			}
		};
		try {
			const mesh = trysteroMesh(
				"discovery-off",
				"k".repeat(43),
				{
					trackers: [],
					nostrRelays: [],
					mqttBrokers: [],
					rtc: { iceServers: [] },
				},
				{ monotonic: () => performance.now(), wall: () => Date.now() },
			)(handlers);
			mesh.tick();
			expect(opened).toEqual([]);
			expect(relaySockets()).toEqual({ tracker: {}, nostr: {}, mqtt: {} });
			expect(mesh.diagnostics()).toMatchObject({ relays: [], stun: [] });
			await mesh.leave();
		} finally {
			globalThis.WebSocket = Native;
		}
	});
});
