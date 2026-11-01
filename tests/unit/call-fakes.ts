import type { Form } from "../../src/call/device-class";
import type { CallLink, LinkOptions } from "../../src/call/mesh";
import {
	join,
	type Party,
	type PresetId,
	presetById,
} from "../../src/call/policy";
import type { Seat } from "../../src/protocol";

export function party(preset: PresetId, form: Form = "desktop"): Party {
	return { prefs: join(presetById(preset).switches, form), form };
}

export const AUDIO = party("audio");
export const BOTH = party("both");

/** A valid call session ID that shows its order: `session(1)` is the first. */
export function session(n: number): string {
	return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function pairOf(a: Seat, b: Seat): string {
	return [a, b].sort().join("");
}

/**
 * The open table connections between the seats of one test. As in `peer.ts`, the impolite link of a pair adds the
 * media sections, and the sections stay on the connection after the link closes; a link is connected while its
 * pair has sections and its own side of the connection is up.
 */
export class FakeConnections {
	readonly #negotiated = new Set<string>();
	readonly #links: FakeLink[] = [];

	open(self: Seat, options: LinkOptions): FakeLink {
		const link = new FakeLink(options, pairOf(self, options.seat), this);
		this.#links.push(link);
		if (!options.polite) this.#negotiated.add(link.pair);
		this.refresh(link.pair);
		return link;
	}

	/** Connects the open links of a pair after the current task, as a negotiation finishes later. */
	refresh(pair: string): void {
		queueMicrotask(() => {
			const negotiated = this.#negotiated.has(pair);
			for (const link of this.#links) {
				if (link.pair === pair) link.settle(negotiated);
			}
		});
	}
}

/** Stands in for `peer.ts` in the mesh tests. */
export class FakeLink implements CallLink {
	connected = false;
	closed = false;
	local: Party;
	remote: Party;
	/** How often a new connect window started. */
	renewals = 0;
	/** This side of the table connection is down. */
	#down = false;

	constructor(
		readonly options: LinkOptions,
		readonly pair: string,
		readonly connections: FakeConnections,
	) {
		this.local = options.local;
		this.remote = options.remote;
	}

	update(local: Party, remote: Party): void {
		this.local = local;
		this.remote = remote;
	}

	renew(): void {
		this.renewals++;
	}

	close(): void {
		this.closed = true;
		this.connected = false;
	}

	/** The table connection dropped on this side. */
	fail(): void {
		this.#down = true;
		this.connected = false;
		this.options.onState();
	}

	/** The table connected again, and the link moved to the new connection. */
	recover(): void {
		this.#down = false;
		this.connections.refresh(this.pair);
	}

	settle(negotiated: boolean): void {
		if (this.closed || this.#down || this.connected || !negotiated) return;
		this.connected = true;
		this.options.onState();
	}
}
