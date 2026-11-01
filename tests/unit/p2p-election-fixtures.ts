import { expect } from "vitest";
import type { Authority, Position } from "../../src/p2p/authority";
import {
	type ElectionEffect,
	type ElectionEvent,
	type ElectionState,
	type ElectionView,
	electionView,
	initElection,
	type Seating,
	type SelfFacts,
	stepElection,
} from "../../src/p2p/election";
import { makeTag } from "../../src/p2p/keys";
import { BEAT_MS, MAX_TERM, TICK_MS } from "../../src/p2p/limits";
import { type Beat, frame, parseCtl } from "../../src/p2p/wire";
import type { Seat } from "../../src/protocol";
import { AUTH_1, AUTH_2, HOLDER_N, TABLE } from "./p2p-fixtures";

export const HOLDER_S = "SSSSSSSSSSSSSSSS";
export const HOLDER_W = "zzzzzzzzzzzzzzzz";
export const VISITOR = "vvvvvvvvvvvvvvvv";
export const TAG_W = makeTag(HOLDER_W, "W");
/** Same term as AUTH_2 with a higher tag, so AUTH_2 beats it. */
export const AUTH_S2: Authority = {
	term: 2,
	tag: makeTag(HOLDER_S, "S"),
	inc: 1,
};
/** AUTH_2 after a resume: the higher incarnation beats AUTH_2. */
export const AUTH_E2_RESUMED: Authority = { ...AUTH_2, inc: 2 };
export const POS: Position = { rev: 1, lastAuth: AUTH_1 };

export interface Report {
	readonly auth: Authority;
	readonly seenAgoMs: number;
}

export interface Source {
	readonly peer: string;
	readonly beat: Beat;
}

export function seating(seat: Seat, overrides: Partial<Seating> = {}): Seating {
	return {
		seat,
		pos: POS,
		host: AUTH_1,
		inc: 0,
		bound: true,
		persistent: true,
		writable: true,
		...overrides,
	};
}

export function facts(holder: string, seat: Seating | null): SelfFacts {
	return { holder, seating: seat };
}

export function leaderBeat(
	auth: Authority,
	role: "host" | "claiming" = "host",
	pos: Position = { rev: 1, lastAuth: auth },
): Beat {
	const [holder = "", seat] = auth.tag.split(".");
	return { k: "beat", role, auth, pos, holder, seat: seat as Seat, elig: true };
}

export function followerBeat(
	holder: string,
	seat: Seat,
	options: {
		report?: Report;
		pos?: Position;
		elig?: boolean;
		pref?: Seat;
	} = {},
): Beat {
	return {
		k: "beat",
		role: "follower",
		holder,
		seat,
		pos: options.pos ?? POS,
		elig: options.elig ?? true,
		...options.report,
		...(options.pref === undefined ? {} : { pref: options.pref }),
	};
}

export function visitorBeat(holder: string, report?: Report): Beat {
	return { k: "beat", role: "visitor", holder, elig: false, ...report };
}

/** A report from a page that never had a beat from `auth` itself. */
export function hearsay(auth: Authority): Report {
	return { auth, seenAgoMs: MAX_TERM };
}

export function ofType<T extends ElectionEffect["type"]>(
	effects: readonly ElectionEffect[],
	type: T,
): Extract<ElectionEffect, { type: T }>[] {
	return effects.filter(
		(effect): effect is Extract<ElectionEffect, { type: T }> =>
			effect.type === type,
	);
}

export function expectWireBeats(effects: readonly ElectionEffect[]): void {
	for (const effect of ofType(effects, "beat")) {
		expect(parseCtl(frame(TABLE, effect.beat), TABLE).ok).toBe(true);
	}
}

/** One page's election, stepped like the controller does. Every beat it emits must pass the wire validator. */
export class Page {
	state: ElectionState;
	readonly initial: readonly ElectionEffect[];

	constructor(
		self: SelfFacts,
		options: { creator?: boolean; online?: boolean } = {},
	) {
		const init = initElection({
			now: 0,
			self,
			creator: options.creator ?? false,
		});
		this.state = init.state;
		this.initial = init.effects;
		expectWireBeats(init.effects);
		if (options.online ?? true) {
			this.step({ type: "network", now: 0, online: true });
		}
	}

	get now(): number {
		return this.state.now;
	}

	get view(): ElectionView {
		return electionView(this.state);
	}

	get mode(): string {
		return this.state.mode.kind;
	}

	step(event: ElectionEvent): readonly ElectionEffect[] {
		const next = stepElection(this.state, event);
		this.state = next.state;
		expectWireBeats(next.effects);
		return next.effects;
	}

	hear(peer: string, beat: Beat, now = this.now): readonly ElectionEffect[] {
		return this.step({ type: "beat", now, peer, beat });
	}

	tick(now: number): readonly ElectionEffect[] {
		return this.step({ type: "tick", now });
	}

	/** Ticks every TICK_MS for `ms`; each source beats on the first tick and every BEAT_MS after it. */
	run(ms: number, sources: readonly Source[] = []): ElectionEffect[] {
		const start = this.now;
		const out: ElectionEffect[] = [];
		for (let t = start + TICK_MS; t <= start + ms; t += TICK_MS) {
			if ((t - start - TICK_MS) % BEAT_MS === 0) {
				for (const { peer, beat } of sources) {
					out.push(...this.hear(peer, beat, t));
				}
			}
			out.push(...this.tick(t));
		}
		return out;
	}
}

export function west(overrides: Partial<Seating> = {}): Page {
	return new Page(facts(HOLDER_W, seating("W", overrides)));
}

export function creator(): Page {
	return new Page(facts(HOLDER_N, seating("N", { inc: 1 })), {
		creator: true,
	});
}

export const VISITOR_WITNESS: Source = {
	peer: "pV",
	beat: visitorBeat(VISITOR, hearsay(AUTH_1)),
};
