import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import type { OpeningPayoffs } from "./opening-payoffs";

type Rank = "ranked" | "standard" | "high";
export type LeadRule = { readonly rank: Rank; readonly margin: number } | null;

export function pickLead(row: OpeningPayoffs, rule: LeadRule) {
	return rule && row[rule.rank].gap <= rule.margin
		? row[rule.rank]
		: row.incumbent;
}

export function compareLead(
	row: OpeningPayoffs,
	rule: LeadRule,
	control: LeadRule,
) {
	return scoreDifferenceToImps(
		pickLead(row, rule).points - pickLead(row, control).points,
	);
}

const rules: readonly LeadRule[] = [
	null,
	...[0, 0.25, 0.5, 0.75, 1].flatMap((margin) =>
		(["ranked", "standard", "high"] as const).map((rank) => ({ rank, margin })),
	),
];

export function leadTotals() {
	return rules.map(() => ({ imps: 0, changes: 0 }));
}

export function addLeadTraining(
	totals: ReturnType<typeof leadTotals>,
	row: OpeningPayoffs,
) {
	for (const [i, rule] of rules.entries()) {
		const total = totals[i];
		if (!total || !rule) continue;
		const lead = pickLead(row, rule);
		total.imps += scoreDifferenceToImps(lead.points - row.incumbent.points);
		if (lead.card !== row.incumbent.card) total.changes++;
	}
}

/** Maximize signed training IMPs, retaining the least intervention on ties. */
export function fitLeadTotals(totals: ReturnType<typeof leadTotals>): LeadRule {
	let best = 0;
	let bestImps = 0;
	let leastChanges = 0;
	for (const [i, { imps, changes }] of totals.entries()) {
		if (imps > bestImps || (imps === bestImps && changes < leastChanges)) {
			best = i;
			bestImps = imps;
			leastChanges = changes;
		}
	}
	return rules[best] ?? null;
}

export function fitLead(rows: readonly OpeningPayoffs[]): LeadRule {
	const totals = leadTotals();
	for (const row of rows) addLeadTraining(totals, row);
	return fitLeadTotals(totals);
}
