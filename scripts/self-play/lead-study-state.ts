export interface StudyProtocol {
	readonly arms: readonly string[];
	readonly firstSeed: number;
	readonly screenDeals: number;
	readonly holdoutDeals: number;
}

export interface Totals {
	wins: number;
	ties: number;
	losses: number;
	failures: number;
	sum: number;
	squares: number;
}

type Outcome = number | null;

interface Screen {
	kind: "screen";
	start: number;
	deal: number;
	arm: number;
	totals: Totals[];
}

interface Holdout {
	kind: "holdout";
	start: number;
	arm: number;
	deals: number;
	contrasts: Outcome[];
}

type Phase = Screen | Holdout;

export interface StudyState {
	cycles: number;
	pairs: number;
	phase: Phase;
	lastScreen: Screen | null;
	recentHoldouts: Holdout[];
	evidence: Totals[];
	lastFailure: { seed: number; arm: number; message: string } | null;
}

const RETAIN_HOLDOUTS = 8;

function empty(): Totals {
	return { wins: 0, ties: 0, losses: 0, failures: 0, sum: 0, squares: 0 };
}

function screen(protocol: StudyProtocol, start: number): Screen {
	return {
		kind: "screen",
		start,
		deal: 0,
		arm: 0,
		totals: protocol.arms.map(empty),
	};
}

export function startStudy(protocol: StudyProtocol): StudyState {
	return {
		cycles: 0,
		pairs: 0,
		phase: screen(protocol, protocol.firstSeed),
		lastScreen: null,
		recentHoldouts: [],
		evidence: protocol.arms.map(empty),
		lastFailure: null,
	};
}

function record(totals: Totals, outcome: Outcome): void {
	if (outcome === null) {
		totals.failures++;
		return;
	}
	if (outcome > 0) totals.wins++;
	else if (outcome < 0) totals.losses++;
	else totals.ties++;
	totals.sum += outcome;
	totals.squares += outcome * outcome;
}

function mean(totals: Totals): number {
	return totals.sum / (totals.wins + totals.ties + totals.losses || 1);
}

function armValue<T>(values: readonly T[], arm: number): T {
	const value = values[arm];
	if (
		!Number.isInteger(arm) ||
		arm < 0 ||
		arm >= values.length ||
		value === undefined
	)
		throw new Error(`Invalid study arm cursor: ${arm}`);
	return value;
}

export function nextPair(state: StudyState) {
	const { phase } = state;
	const seed =
		phase.start +
		(phase.kind === "screen" ? phase.deal : phase.contrasts.length);
	if (seed >= 2 ** 32)
		throw new Error("Study exhausted the 32-bit deal seed range");
	return { seed, searchSeed: (seed ^ 0xa36c195f) >>> 0, arm: phase.arm };
}

export type Milestone =
	| {
			kind: "SCREEN";
			start: number;
			endExclusive: number;
			arms: Record<string, Totals>;
			candidate: string | null;
			plannedHoldoutDeals: number;
	  }
	| {
			kind: "HOLDOUT";
			start: number;
			endExclusive: number;
			candidate: string;
			shard: Totals;
			cumulative: Totals;
	  };

export function finishPair(
	state: StudyState,
	protocol: StudyProtocol,
	result: number | string,
): Milestone | undefined {
	const { seed, arm } = nextPair(state);
	const { phase } = state;
	const name = armValue(protocol.arms, arm);
	const totals = armValue(
		phase.kind === "holdout" ? state.evidence : phase.totals,
		arm,
	);
	if (
		state.evidence.length !== protocol.arms.length ||
		(phase.kind === "screen" && phase.totals.length !== protocol.arms.length)
	)
		throw new Error("Study checkpoint arm totals do not match the protocol");
	const outcome = typeof result === "string" ? null : result;
	if (typeof result === "string")
		state.lastFailure = { seed, arm, message: result.slice(0, 400) };
	state.pairs++;
	if (phase.kind === "holdout") {
		phase.contrasts.push(outcome);
		record(totals, outcome);
		if (phase.contrasts.length !== phase.deals) return;
		const shard = empty();
		for (const contrast of phase.contrasts) record(shard, contrast);
		state.recentHoldouts.push(phase);
		if (state.recentHoldouts.length > RETAIN_HOLDOUTS)
			state.recentHoldouts.shift();
		state.phase = screen(protocol, seed + 1);
		state.cycles++;
		return {
			kind: "HOLDOUT",
			start: phase.start,
			endExclusive: seed + 1,
			candidate: name,
			shard,
			cumulative: totals,
		};
	}

	record(totals, outcome);
	phase.arm++;
	if (phase.arm !== protocol.arms.length) return;
	phase.arm = 0;
	phase.deal++;
	if (phase.deal !== protocol.screenDeals) return;

	let candidate = -1;
	let best = 0;
	for (const [index, totals] of phase.totals.entries()) {
		if (totals.failures === 0 && totals.sum > best) {
			candidate = index;
			best = totals.sum;
		}
	}
	state.lastScreen = phase;
	let plannedHoldoutDeals = 0;
	if (candidate < 0) {
		state.phase = screen(protocol, seed + 1);
		state.cycles++;
	} else {
		const prior = armValue(state.evidence, candidate);
		const promising =
			prior.failures === 0 &&
			mean(prior) > 0 &&
			state.evidence.every((totals) => mean(prior) >= mean(totals));
		plannedHoldoutDeals = protocol.holdoutDeals * (promising ? 2 : 1);
		state.phase = {
			kind: "holdout",
			start: seed + 1,
			arm: candidate,
			deals: plannedHoldoutDeals,
			contrasts: [],
		};
	}
	return {
		kind: "SCREEN",
		start: phase.start,
		endExclusive: seed + 1,
		arms: Object.fromEntries(
			protocol.arms.map((name, index) => [name, armValue(phase.totals, index)]),
		),
		candidate: protocol.arms[candidate] ?? null,
		plannedHoldoutDeals,
	};
}
