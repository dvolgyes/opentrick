import { describe, expect, it } from "vitest";
import {
	MAX_OPEN_PINGS,
	PING_TIMEOUT_MS,
	ROUND_TRIP_IDLE_MS,
} from "../../src/p2p/limits";
import { RoundTripProbes } from "../../src/p2p/round-trips";
import type { Ping } from "../../src/p2p/wire";

const EAST = "east";
const SOUTH = "south";

class Rig {
	now = 0;
	readonly pings: { peer: string; message: Ping }[] = [];
	#next = 0;
	readonly probes = new RoundTripProbes({
		now: () => this.now,
		nonce: () => `nonce-${String(this.#next++).padStart(4, "0")}`,
		ping: (peer, message) => this.pings.push({ peer, message }),
	});

	/** The nonce of the latest ping to `peer`. */
	last(peer: string): string {
		const ping = this.pings.findLast((item) => item.peer === peer);
		if (!ping) throw new Error(`no ping to ${peer}`);
		return ping.message.n;
	}
}

describe("RoundTripProbes", () => {
	it("measures the time from a ping to its echo", () => {
		const rig = new Rig();
		rig.probes.probe(EAST);
		expect(rig.pings).toEqual([
			{ peer: EAST, message: { k: "ping", n: "nonce-0000" } },
		]);
		rig.now = 180;
		expect(rig.probes.echo(EAST, "nonce-0000")).toBe(true);
		expect(rig.probes.get(EAST)).toEqual({ ms: 180, lower: false });
	});

	it("ignores an echo that answers no open ping of the peer", () => {
		const rig = new Rig();
		rig.probes.probe(EAST);
		expect(rig.probes.echo(SOUTH, rig.last(EAST))).toBe(false);
		expect(rig.probes.echo(EAST, "nonce-9999")).toBe(false);
		expect(rig.probes.echo(EAST, rig.last(EAST))).toBe(true);
		expect(rig.probes.echo(EAST, rig.last(EAST))).toBe(false);
		expect(rig.probes.get(SOUTH)).toBeNull();
	});

	it("pings a peer at once, then again only after ROUND_TRIP_IDLE_MS without a ping", () => {
		const rig = new Rig();
		rig.probes.tick([EAST]);
		expect(rig.pings).toHaveLength(1);
		rig.probes.echo(EAST, rig.last(EAST));
		rig.now = ROUND_TRIP_IDLE_MS - 1;
		rig.probes.tick([EAST]);
		expect(rig.pings).toHaveLength(1);
		rig.now = ROUND_TRIP_IDLE_MS;
		rig.probes.tick([EAST]);
		expect(rig.pings).toHaveLength(2);
		// A ping after a broadcast restarts the idle time.
		rig.now = ROUND_TRIP_IDLE_MS + 4_000;
		rig.probes.probe(EAST);
		rig.now = 2 * ROUND_TRIP_IDLE_MS;
		rig.probes.tick([EAST]);
		expect(rig.pings).toHaveLength(3);
	});

	it("gives a lower bound when a ping has no echo within PING_TIMEOUT_MS", () => {
		const rig = new Rig();
		rig.probes.probe(EAST);
		rig.now = 100;
		rig.probes.echo(EAST, rig.last(EAST));
		rig.probes.probe(EAST);
		rig.now = 100 + PING_TIMEOUT_MS - 1;
		expect(rig.probes.tick([])).toBe(false);
		expect(rig.probes.get(EAST)).toEqual({ ms: 100, lower: false });
		rig.now = 100 + PING_TIMEOUT_MS;
		expect(rig.probes.tick([])).toBe(true);
		expect(rig.probes.get(EAST)).toEqual({ ms: PING_TIMEOUT_MS, lower: true });
		// More lost pings do not change the lower bound.
		rig.probes.probe(EAST);
		rig.now += PING_TIMEOUT_MS;
		expect(rig.probes.tick([])).toBe(false);
		// The late echo of a closed ping is ignored; the next answered ping is measured again.
		expect(rig.probes.echo(EAST, "nonce-0001")).toBe(false);
		rig.probes.probe(EAST);
		rig.now += 300;
		expect(rig.probes.echo(EAST, rig.last(EAST))).toBe(true);
		expect(rig.probes.get(EAST)).toEqual({ ms: 300, lower: false });
	});

	it("an echo closes the older open pings of the peer", () => {
		const rig = new Rig();
		rig.probes.probe(EAST);
		rig.now = 50;
		rig.probes.probe(EAST);
		rig.now = 250;
		rig.probes.echo(EAST, rig.last(EAST));
		rig.now = 50 + PING_TIMEOUT_MS;
		expect(rig.probes.tick([])).toBe(false);
		expect(rig.probes.get(EAST)).toEqual({ ms: 200, lower: false });
		expect(rig.probes.echo(EAST, "nonce-0000")).toBe(false);
	});

	it("keeps at most MAX_OPEN_PINGS open pings for a peer", () => {
		const rig = new Rig();
		for (let index = 0; index <= MAX_OPEN_PINGS; index += 1)
			rig.probes.probe(EAST);
		expect(rig.probes.echo(EAST, "nonce-0000")).toBe(false);
		expect(rig.probes.echo(EAST, "nonce-0001")).toBe(true);
	});

	it("forgets a peer, and tells whether the peer had a result", () => {
		const rig = new Rig();
		rig.probes.probe(EAST);
		rig.probes.probe(SOUTH);
		rig.probes.echo(EAST, rig.last(EAST));
		expect(rig.probes.forget(EAST)).toBe(true);
		expect(rig.probes.forget(SOUTH)).toBe(false);
		expect(rig.probes.get(EAST)).toBeNull();
		expect(rig.probes.echo(SOUTH, rig.last(SOUTH))).toBe(false);
	});
});
