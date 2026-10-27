import { describe, expect, it } from "vitest";
import { PING_TIMEOUT_MS, ROUND_TRIP_IDLE_MS } from "../../src/p2p/limits";
import {
	PeerQuality,
	QUALITY_REPORT_TTL_MS,
	type QualityContext,
} from "../../src/p2p/peer-quality";
import {
	type Binding,
	frame,
	type PeerRoundTrips,
	type Ping,
	parseCtl,
	type Roster,
} from "../../src/p2p/wire";
import { SEATS, type Seat } from "../../src/protocol";

const bindings: Binding[] = SEATS.map((seat) => ({
	seat,
	peer: seat.repeat(20),
	gen: 1,
}));
const roster: Roster = {
	k: "roster",
	auth: { term: 1, tag: "AAAAAAAAAAAAAAAA.N", inc: 1 },
	seats: SEATS.map((seat) => ({
		seat,
		gen: 1,
		holder: seat.repeat(16),
		acked: 1,
	})),
	peers: bindings,
	bots: [],
	autoplaySeats: [],
};
const binding = (seat: Seat): Binding =>
	bindings[SEATS.indexOf(seat)] as Binding;

class Rig {
	now = 0;
	nonce = 0;
	readonly pings: { peer: string; message: Ping }[] = [];
	readonly reports: { peer: string; message: PeerRoundTrips }[] = [];
	context: QualityContext;
	readonly quality = new PeerQuality({
		now: () => this.now,
		nonce: () => `nonce-${this.nonce++}`,
		ping: (peer, message) => this.pings.push({ peer, message }),
		report: (peer, message) => this.reports.push({ peer, message }),
	});
	constructor(seat: Seat = "N") {
		this.context = {
			self: binding(seat).peer,
			hosting: seat === "N",
			roster,
			connected: bindings
				.filter((item) => item.seat !== seat)
				.map((item) => item.peer),
		};
		this.update({});
	}
	update(change: Partial<QualityContext>): void {
		this.context = { ...this.context, ...change };
		this.quality.update(this.context);
	}
	tick(): void {
		this.update({});
		this.quality.tick();
	}
	echo(seat: Seat): void {
		const ping = this.pings.findLast(
			(item) => item.peer === binding(seat).peer,
		);
		if (!ping) throw new Error(`no ping to ${seat}`);
		expect(this.quality.echo(ping.peer, ping.message.n)).toBe(true);
	}
	row(from: Seat, to: Seat, ms = 180): PeerRoundTrips {
		return {
			k: "peer-round-trips",
			auth: this.context.roster?.auth ?? roster.auth,
			gen: binding(from).gen,
			seats: [{ ...binding(to), ms }],
		};
	}
}

describe("directed peer quality", () => {
	it("reports a valid timeout when an echo arrives after a suspended page resumes", () => {
		const guest = new Rig("E");
		guest.tick();
		// Browser timers can be suspended while the echo remains queued for delivery.
		guest.now = 90_000;
		guest.echo("N");
		guest.tick();
		const message = guest.reports.at(-1)?.message;
		if (!message) throw new Error("no quality report");
		expect(parseCtl(frame("table", message), "table")).toEqual({
			ok: true,
			message,
		});
		expect(message?.seats.find((sample) => sample.seat === "N")).toMatchObject({
			ms: PING_TIMEOUT_MS,
			lower: true,
		});
	});

	it("each guest probes the host and other guests, and reports only its own measurements to the host", () => {
		const east = new Rig("E");
		east.tick();
		expect(east.pings.map((ping) => ping.peer)).toEqual(
			["N", "S", "W"].map((seat) => seat.repeat(20)),
		);
		east.now = 40;
		east.echo("N");
		east.now = 900;
		east.echo("S");
		east.tick();
		expect(east.quality.local()).toEqual([
			{ seat: "N", ms: 40 },
			{ seat: "S", ms: 900 },
		]);
		expect(east.quality.matrix()).toEqual([]);
		const report = east.reports.at(-1);
		expect(report?.peer).toBe(binding("N").peer);
		const host = new Rig();
		host.tick();
		host.now = 70;
		host.echo("E");
		expect(
			host.quality.receive(
				binding("E").peer,
				report?.message as PeerRoundTrips,
			),
		).toBe(true);
		expect(
			host.quality.matrix().find((row) => row.seat === "N")?.seats,
		).toEqual([{ seat: "E", ms: 70 }]);
		expect(
			host.quality.matrix().find((row) => row.seat === "E")?.seats,
		).toEqual(east.quality.local());
	});

	it("ties echoes to the sender and nonce, and exposes a timeout lower bound", () => {
		const rig = new Rig("E");
		rig.tick();
		const ping = rig.pings[0]?.message as Ping;
		expect(rig.quality.echo(binding("S").peer, ping.n)).toBe(false);
		expect(rig.quality.echo(binding("N").peer, "unknown")).toBe(false);
		rig.now = PING_TIMEOUT_MS;
		rig.tick();
		expect(rig.quality.local()).toEqual(
			["N", "S", "W"].map((seat) => ({
				seat,
				ms: PING_TIMEOUT_MS,
				lower: true,
			})),
		);
	});

	it("derives the row from the connected sender and rejects stale authority, generation and targets", () => {
		const rig = new Rig();
		const report = rig.row("E", "S");
		expect(rig.quality.receive("stranger", report)).toBe(false);
		expect(rig.quality.receive(binding("N").peer, report)).toBe(false);
		expect(
			rig.quality.receive(binding("E").peer, {
				...report,
				auth: { ...roster.auth, inc: 2 },
			}),
		).toBe(false);
		expect(rig.quality.receive(binding("E").peer, { ...report, gen: 2 })).toBe(
			false,
		);
		for (const target of [
			{ ...binding("S"), gen: 2 },
			{ ...binding("S"), peer: "replaced" },
			binding("E"),
		]) {
			rig.quality.receive(binding("E").peer, {
				...report,
				seats: [{ ...target, ms: 99 }],
			});
			expect(
				rig.quality.matrix().find((row) => row.seat === "E")?.seats,
			).toEqual([]);
		}
		rig.quality.receive(binding("S").peer, rig.row("S", "E", 70));
		rig.quality.receive(binding("E").peer, report);
		expect(rig.quality.matrix().find((row) => row.seat === "S")?.seats).toEqual(
			[{ seat: "E", ms: 70 }],
		);
	});

	it("forgets both directions on disconnect and same-generation page replacement", () => {
		const rig = new Rig();
		rig.tick();
		rig.now = 40;
		rig.echo("E");
		rig.quality.receive(binding("E").peer, rig.row("E", "N"));
		rig.quality.receive(binding("S").peer, rig.row("S", "E"));
		rig.update({ connected: [binding("S").peer, binding("W").peer] });
		expect(rig.quality.local()).toEqual([]);
		expect(rig.quality.matrix().flatMap((row) => row.seats)).toEqual([]);
		rig.update({ connected: bindings.slice(1).map((item) => item.peer) });
		expect(rig.quality.matrix().flatMap((row) => row.seats)).toEqual([]);
		rig.tick();
		rig.echo("E");
		rig.update({
			roster: {
				...roster,
				peers: bindings.map((item) =>
					item.seat === "E" ? { ...item, peer: "new-east" } : item,
				),
			},
			connected: ["new-east", binding("S").peer, binding("W").peer],
		});
		expect(rig.quality.local()).toEqual([]);
		expect(rig.quality.receive(binding("E").peer, rig.row("E", "N"))).toBe(
			false,
		);
	});

	it("excludes bot-marked seats, resumes when human, and still collects reports when the host uses autoplay", () => {
		const rig = new Rig();
		rig.tick();
		rig.echo("E");
		rig.update({
			roster: { ...roster, bots: ["E", "N"], autoplaySeats: ["N"] },
		});
		expect(rig.quality.local()).toEqual([]);
		expect(rig.quality.receive(binding("E").peer, rig.row("E", "S"))).toBe(
			false,
		);
		rig.quality.receive(binding("S").peer, rig.row("S", "W"));
		rig.update({});
		expect(rig.quality.matrix().find((row) => row.seat === "S")?.seats).toEqual(
			[{ seat: "W", ms: 180 }],
		);
		const south = new Rig("S");
		south.update({ roster: { ...roster, bots: ["N"] } });
		south.tick();
		expect(south.reports[0]?.peer).toBe(binding("N").peer);
		rig.update({ roster });
		rig.tick();
		rig.echo("E");
		expect(rig.quality.local()).toEqual([{ seat: "E", ms: 0 }]);
	});

	it("expires rows without reports, resends unchanged values, and rebuilds at a host change", () => {
		const host = new Rig();
		const east = new Rig("E");
		east.tick();
		east.echo("N");
		east.tick();
		const sent = east.reports.length;
		east.tick();
		expect(east.reports).toHaveLength(sent);
		east.now = ROUND_TRIP_IDLE_MS;
		east.tick();
		expect(east.reports.length).toBeGreaterThan(sent);
		host.quality.receive(binding("E").peer, host.row("E", "N"));
		host.now = QUALITY_REPORT_TTL_MS;
		expect(
			host.quality.matrix().find((row) => row.seat === "E")?.seats,
		).toEqual([]);
		const next = {
			...roster,
			auth: { term: 2, tag: "AAAAAAAAAAAAAAAA.S", inc: 1 },
		};
		east.update({ roster: next });
		east.tick();
		expect(east.reports.at(-1)?.peer).toBe(binding("S").peer);
		expect(east.reports.at(-1)?.message.auth).toEqual(next.auth);
		host.update({ hosting: false, roster: next });
		expect(host.quality.matrix()).toEqual([]);
	});
});
