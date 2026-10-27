import { SEATS, type Seat } from "../protocol";
import { sameAuthority } from "./authority";
import { tagSeat } from "./keys";
import { PING_TIMEOUT_MS, ROUND_TRIP_IDLE_MS } from "./limits";
import { type RoundTripDeps, RoundTripProbes } from "./round-trips";
import type { Binding, PeerRoundTrips, Roster, SeatRoundTrip } from "./wire";

/** Missing reports cease to be evidence, even if the sender's data channel stays open. */
export const QUALITY_REPORT_TTL_MS = 2 * ROUND_TRIP_IDLE_MS + PING_TIMEOUT_MS;

export interface QualityRow {
	readonly seat: Seat;
	readonly seats: readonly SeatRoundTrip[];
}

export interface QualityContext {
	readonly self: string;
	readonly hosting: boolean;
	readonly roster: Roster | null;
	readonly connected: readonly string[];
}

interface QualityDeps extends RoundTripDeps {
	readonly report: (host: string, message: PeerRoundTrips) => void;
}

function sameBinding(a: Binding, b: Binding | undefined): boolean {
	return a.peer === b?.peer && a.seat === b.seat && a.gen === b.gen;
}

/** Local probes and a host-only collection of directed reports. This telemetry never affects game authority. */
export class PeerQuality {
	readonly #deps: QualityDeps;
	readonly #probes: RoundTripProbes;
	readonly #reports = new Map<
		string,
		{ message: PeerRoundTrips; at: number }
	>();
	#context: QualityContext = {
		self: "",
		hosting: false,
		roster: null,
		connected: [],
	};
	#bindings: readonly Binding[] = [];
	#sent: string | null = null;
	#sentAt = -Infinity;

	constructor(deps: QualityDeps) {
		this.#deps = deps;
		this.#probes = new RoundTripProbes(deps);
	}

	update(context: QualityContext): void {
		const previous = this.#context;
		if (
			!previous.roster ||
			!context.roster ||
			!sameAuthority(previous.roster.auth, context.roster.auth) ||
			previous.hosting !== context.hosting
		) {
			this.#reports.clear();
			this.#sent = null;
		}
		const bindings = (context.roster?.peers ?? []).filter(
			(binding) =>
				!context.roster?.bots.includes(binding.seat) &&
				(binding.peer === context.self ||
					context.connected.includes(binding.peer)),
		);
		const own = bindings.find((binding) => binding.peer === context.self);
		const oldOwn = this.#bindings.find(
			(binding) => binding.peer === previous.self,
		);
		for (const old of this.#bindings) {
			if (
				!own ||
				!oldOwn ||
				!sameBinding(oldOwn, own) ||
				!sameBinding(
					old,
					bindings.find((binding) => binding.peer === old.peer),
				)
			) {
				this.#probes.forget(old.peer);
			}
			if (
				!sameBinding(
					old,
					bindings.find((binding) => binding.peer === old.peer),
				)
			)
				this.#reports.delete(old.peer);
		}
		// Remove replaced targets permanently; a later reconnection must not revive an old sample.
		for (const [peer, report] of this.#reports) {
			report.message = {
				...report.message,
				seats: report.message.seats.filter((sample) =>
					sameBinding(
						sample,
						bindings.find((binding) => binding.seat === sample.seat),
					),
				),
			};
			if (this.#deps.now() - report.at >= QUALITY_REPORT_TTL_MS)
				this.#reports.delete(peer);
		}
		this.#bindings = bindings;
		this.#context = context;
	}

	tick(): void {
		const own = this.#own();
		if (!own) return;
		this.#probes.tick(
			this.#bindings
				.filter((binding) => binding.peer !== own.peer)
				.map((binding) => binding.peer),
		);
		const roster = this.#context.roster;
		if (!roster || this.#context.hosting) return;
		const host = roster.peers.find(
			(binding) => binding.seat === tagSeat(roster.auth.tag),
		);
		if (
			!host ||
			host.peer === own.peer ||
			!this.#context.connected.includes(host.peer)
		)
			return;
		const message: PeerRoundTrips = {
			k: "peer-round-trips",
			auth: roster.auth,
			gen: own.gen,
			seats: this.#samples(),
		};
		const serialized = JSON.stringify(message);
		if (
			serialized !== this.#sent ||
			this.#deps.now() - this.#sentAt >= ROUND_TRIP_IDLE_MS
		) {
			this.#sent = serialized;
			this.#sentAt = this.#deps.now();
			this.#deps.report(host.peer, message);
		}
	}

	echo(peer: string, nonce: string): boolean {
		return this.#probes.echo(peer, nonce);
	}

	receive(peer: string, message: PeerRoundTrips): boolean {
		const roster = this.#context.roster;
		const source = this.#bindings.find((binding) => binding.peer === peer);
		if (
			!this.#context.hosting ||
			!roster ||
			!sameAuthority(roster.auth, message.auth) ||
			!source ||
			source.peer === this.#context.self ||
			source.gen !== message.gen
		)
			return false;
		this.#reports.set(peer, {
			at: this.#deps.now(),
			message: {
				...message,
				seats: message.seats.filter(
					(sample) =>
						sample.seat !== source.seat &&
						sameBinding(
							sample,
							this.#bindings.find((binding) => binding.seat === sample.seat),
						),
				),
			},
		});
		return true;
	}

	local(): SeatRoundTrip[] {
		return this.#samples().map(({ seat, ms, lower }) => ({
			seat,
			ms,
			...(lower ? { lower } : {}),
		}));
	}

	matrix(): QualityRow[] {
		if (!this.#context.hosting) return [];
		return SEATS.flatMap((seat) => {
			const binding = this.#bindings.find((binding) => binding.seat === seat);
			if (!binding) return [];
			if (binding.peer === this.#context.self)
				return [{ seat, seats: this.local() }];
			const report = this.#reports.get(binding.peer);
			return [
				{
					seat,
					seats:
						report && this.#deps.now() - report.at < QUALITY_REPORT_TTL_MS
							? report.message.seats.map(({ seat, ms, lower }) => ({
									seat,
									ms,
									...(lower ? { lower } : {}),
								}))
							: [],
				},
			];
		});
	}

	#own(): Binding | undefined {
		return this.#bindings.find(
			(binding) => binding.peer === this.#context.self,
		);
	}

	#samples(): (SeatRoundTrip & Binding)[] {
		const own = this.#own();
		if (!own) return [];
		return this.#bindings.flatMap((binding) => {
			const result =
				binding.peer === own.peer ? null : this.#probes.get(binding.peer);
			return result
				? [
						{
							...binding,
							ms: result.ms,
							...(result.lower ? { lower: true as const } : {}),
						},
					]
				: [];
		});
	}
}
