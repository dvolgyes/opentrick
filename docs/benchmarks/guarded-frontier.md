# Guarded exact-search frontier: 512 layouts from ply 28

## Frozen protocol

Compare the archived cutoff-256 incumbent (`b2858bff0de6c3509e527f5aadfed7a34c2c3aa3`) with exactly one neighbor: 512 layouts only after at least 28 public cards have been played.
Fixed-sample searches remain IID unless explicitly opted into exact search, as before.
Do not use the [rejected unguarded 1024 experiment](expanded-frontier.md) as new evidence.

- Generate two disjoint cohorts at `11700000 + i` and `11800000 + i`, with `0 <= i < 1200`, board number `i + 1` and ply `28 + (floor(i / 5) + i % 5) % 4`.
  The arena rotates the contract strain and chooses legal prefix actions uniformly without either policy.
  Use the independent ending enumerator, censored at 513, to select the first 32 and 64 unique deals respectively with multiple legal cards, no auction hints, and populations 257–512 at the first decision.
  Require at least two distinct actual populations in each selected cohort; if either cohort fails, stop without moving limits or collecting timings or scores.
- Analyze every oracle deal at equal explicit work (one DDS call per population member in aggregate, 60-second guard) with each policy.
  Check the candidate solves every independently enumerated layout once, and check all legal concrete cards, their ranking and their four oracle metrics to `1e-10`.
  Report IID error at the same work without requiring IID ranking agreement.
- Measure external wall time on all oracle deals with no explicit sample cap and the live 5,000 ms time budget in both arms.
  Run two fresh DDS instances for the two passes, warm each by playing both arms on four separate eligible structural reserves, then alternate arm order by deal index and reverse it on pass two.
  Preserve every timing and solve count, and require each candidate to finish exactly the whole population in strictly under 1,000 ms and agree with the oracle.
  Require each incumbent timing to reach 4,500 ms but remain under 8,000 ms, with strictly greater wall time and DDS calls in every match.
- Play every selected pair from the qualifying first decision in side-swapped rooms using matched 512-call ceilings, matched public information, common per-decision RNG streams, and a 60-second work guard.
  Record legal moves, independent population, actual solves, chosen card and actual exact activations for both arms, and both complete room scores.
  Require all 64 candidate first decisions to complete newly exact search, all work counts to match the selected modes, and candidate aggregate solves to be lower.
  Report mean paired IMP, wins, losses, ties, bootstrap one-sided 95% lower and upper bounds, and sign-test probability.
  Reject on a one-sided upper bound below zero; neither passing this screen nor ties demonstrate dominance or equivalence.
- Reject if any prospective gate fails, or work savings do not justify the additional live policy branch.
  Use the unchanged 256 cutoff on rejection.

## Structural rejection

**Keep the cutoff at 256.**
The preflight found enough independent qualifying deals but failed the distinct-population gate in both cohorts.
Every qualifying position, including reserves, had exactly 462 layouts.

| Seed range | Forced | At most 256 | Above 512 | Eligible ply 28 | Eligible ply 29 | Eligible ply 30 | Eligible ply 31 | Selected | Warm | Reserve |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 11700000–11701199 | 226 | 550 | 190 | 51 | 87 | 96 | 0 | 32 | 4 | 198 |
| 11800000–11801199 | 214 | 548 | 201 | 37 | 108 | 92 | 0 | 64 | 0 | 173 |

After 28 public cards, each hidden hand has at most six cards remaining.
Public voids either force an unseen card into one hand or leave it flexible between the two hands.
Once forced cards are allocated, assigning `k` of `m` flexible cards to one hand gives exactly `C(m,k)` layouts, with both hand capacities at most six.
For `m ≤ 10`, the largest population is `C(10,5) = 252`.
For `m = 11`, the capacities must be five and six, giving `C(11,5) = 462`.
For `m = 12`, the capacities must both be six, giving `C(12,6) = 924`.
Thus 462 is the only population in 257–512 at ply 28 or later; neither more seeds nor different cohort selection can meet the frozen gate.

No oracle scores, DDS solve counts, timings, or paired results were collected.
Early and above-cutoff behavior, fixed-sample defaults, and the browser worker were not tested on a candidate because no production branch was changed.
The structural rejection says nothing about the policy's latency or strength at 462 layouts.

## Reproduction

Copy `scripts/self-play/guarded-frontier.ts` into a clean archive of baseline `b2858bff0de6c3509e527f5aadfed7a34c2c3aa3` with its locked dependencies.
Run `node --import tsx scripts/self-play/guarded-frontier.ts > guarded-frontier.jsonl`.
Expect exit status 1 and two structural records with `passed: false` and `distinctPopulations: [462]`.
The retained script reproduced the original two records byte for byte on Node v22.22.1, Linux x64.
The JSONL SHA-256 is `b22cf9ca31d577f8285945038df4dae28026c716b9b4485119420b3df98aa078`.
The formatted reproducer (`8c950abf421ecc5da066ff41021fc2befb2f1fa4621970e02288ee1d5f7857e9`) returned the same JSONL hash and exit status.
