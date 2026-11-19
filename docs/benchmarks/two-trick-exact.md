# Exact two-trick specialization

## Frozen protocol

Use 32 distinct arena boards from deal seeds 12500400 through 12500431, board numbers 1 through 32, and search seeds 12500800 through 12500831.
Run the current obvious-play policy before fixed-budget real analysis, with 16 samples and an exact-layout limit of 256, and assert time does not truncate that fixed budget.
Before running any variant, count all penultimate decisions, obvious decisions, actual DDS calls and distinct sampled layouts by trick offset; stop if no call is eligible.
Compare all available analysis metrics except elapsed time and compare every card and final score of all 32 complete paired games.
Use a separate deterministic corpus of at least 4,096 structurally distinct legal two-trick positions to compare all values per legal card against native DDS and a separate minimax and report native insertion-order disagreements.
Use only explicit trusted internal lookups if native insertion order differs, leaving public validation and injected solvers unchanged.
Use the first nine complete matched pairs for whole-table timing, after a complete warmup table per mode on board 33.
Capture eligible positions from the 32 incumbent traces, replay with fixed matched seeds, warm four blocks of 20 replays, and measure nine paired rounds of 160 replays each.
Warm both modes, pin the process to one core, and measure nine matched rounds in alternating order with identical inputs and real DDS.
Measure repeated whole eligible analyses and complete tables separately; require over 20% median paired eligible reduction and at most 5% median paired whole-table slowdown, with zero semantic differences and verified skipped native calls.
Report paired variability, count and distribution of ordering differences, and qualify noisy whole-table estimates; keep the candidate off if it fails a gate.

## Native-work preflight

At offsets 0, 1, 2, and 3 respectively, 9, 19, 16, and 16 of the 32 positions took `obviousPlay`.
The other 68 positions caused 87, 44, 30, and 25 native solves respectively, with no repeated layout within an analysis.
Those 186 eligible calls were 1.09% of the 17,023 native solves across all 32 tables.

## Correctness and ordering

The deterministic corpus checked 14,161 legal card values across 8,192 positions distinct by relative ranks within each suit and cyclic seat rotation.
The solver matched native DDS and independent minimax on every legal card and also preserved values under reversed hand order and rotated seats.
The independent oracle observed ruffs, undertrumps, and discards, and 1,241 positions had unequal scores among legal root cards.
Candidate insertion order differed from native DDS in 3,018 positions (36.84% of the corpus), with 1,022, 658, 670, and 668 disagreements by partial-trick length.
For scale only, the usual independent-binomial 95% Wilson interval is 35.80–37.89% for ordering disagreements, and the one-sided exact 95% upper bound for zero value discrepancies per position would be 0.037%.
The corpus is a deterministic, stratified, deduplicated sample, so those reference intervals do not establish rates for general gameplay.

An additional canonical checker covered 1,716,516 legal nodes and 2,857,068 card values across 15 suit-length partitions, choosing among 2,520 allocations per shape and checking all present trump suits and notrump.
Its independent oracle agreed at every node, including 221,410 nodes with differing legal card values.
Native DDS agreed on the systematic every-257th sample of 6,679 nodes (11,110 card values).
A separate one-suit notrump control agreed with native DDS at all 37,800 nodes (75,600 card values).
The exhaustive native comparison timed out and is not a claimed result.

## Integration

The browser host applies `obviousPlay` before sending only the public play position to `BrowserPlayEngine`, which starts `play-worker.ts`.
That worker and the local CLI now call `analyzeLocalPlay`; direct `analyzePlay` calls and the public `DdsSolver.solve` contract remain unchanged.
The local selector checks exact trick depth, strain, current-trick provenance and sampled hand sizes before using the existing sampler's validated, duplicate-free card pool.
It delegates to native DDS when the ending shape does not hold.
The worker test posts a structured-cloned partial ending, verifies identical analysis with zero native calls, then checks that invalid trick length and a repeated card still fail through the native adapter.
An additional real Chromium worker test returned the independently calculated 50% versus 0% contract-defeat probabilities for board seed 15920010 at ply 46 and rejected a duplicate visible card.

## Production-shaped results

All fixed-budget analysis metrics other than elapsed time matched across 32 paired complete games and all 1,664 played cards.
The local analyzer bypassed all 186 eligible native solves at 68 decisions and made the same 16,837 native calls elsewhere.
Median whole eligible analysis was 0.791 ms with native DDS and 0.073 ms with the specialization, saving a paired median of 0.715 ms per decision.
The median paired eligible reduction was 90.61%, with a range of 89.90–91.21% across rounds, passing the over-20% gate.
The median paired whole-table change was a 0.20% slowdown, with rounds ranging from a 2.18% slowdown to a 3.06% reduction, passing the at-most-5% slowdown gate.
Whole tables varied materially by deal (about 1.3–6.1 seconds), and the observed whole-table changes are not evidence of an overall speedup.

| Round | Eligible native (ms) | Eligible local (ms) | Whole native (ms) | Whole local (ms) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 8719.5 | 877.6 | 1958.5 | 1965.7 |
| 2 | 8924.8 | 784.1 | 3135.7 | 3098.3 |
| 3 | 8704.1 | 849.3 | 1463.7 | 1437.5 |
| 4 | 8600.7 | 824.8 | 3951.2 | 3830.2 |
| 5 | 8184.7 | 826.5 | 1329.5 | 1289.9 |
| 6 | 8619.2 | 798.1 | 2551.9 | 2607.6 |
| 7 | 8275.6 | 777.0 | 4226.7 | 4235.3 |
| 8 | 8434.6 | 772.1 | 2388.4 | 2420.1 |
| 9 | 8533.3 | 798.7 | 6014.3 | 6092.1 |

Eligible rows cover 10,880 complete analyses each (160 replays of the 68 reached positions), and whole-table rows cover one matched table each.
The specialization stays on only for normal local analysis; public DDS ordering, validation, and behavior outside the two-trick slice stay on the native path.

An independent repeat on CPU 14, with the repository checks restricted to other cores, reproduced the eligible speedup after formatting.
The median times per eligible decision were 0.840 ms native and 0.078 ms local.
All nine paired rounds were 90.41%–91.69% faster on eligible decisions, with a median reduction of 90.61%.
The median whole-table slowdown was 0.16%; individual pairs ranged from a 4.14% speedup to a 29.16% slowdown, so there is no demonstrated whole-table gain.
All 32 game traces again matched, and native calls fell from 17,023 to 16,837, replacing exactly 186 calls.

## Reproduction

Use Node 22 with the repository dependencies installed; the runs used base `bfa83bcf56`, Node 22.22.1, and bridge-dds 1.4.0 on an AMD Ryzen 7 4800H.
Run the preflight before the paired comparison; replace `CPU` below with one available logical CPU.

```sh
taskset -c "$CPU" node --import tsx scripts/self-play/two-trick-profile.ts --preflight
taskset -c "$CPU" node --import tsx scripts/self-play/two-trick-profile.ts
node node_modules/vitest/vitest.mjs run --disableConsoleIntercept tests/unit/two-trick-solver.test.ts tests/unit/two-trick-worker.test.ts
node node_modules/vitest/vitest.mjs run tests/browser/two-trick-play.test.ts
node --import tsx scripts/self-play/canonical-endings.ts candidate
node --import tsx scripts/self-play/canonical-endings.ts native-sample
```

The preliminary dispatch experiment used a symbol-marked score map and shared native solver on CPU 0; all 32 paired traces matched, and the eligible reduction was 90.46% median (89.95–90.89% across rounds) with 0.29% median whole-table reduction (−2.51–6.62%).
The production-shaped comparison ran on CPU 3 and measured the unchanged `analyzePlay` against the explicit local entry point with input checks and independent warm native solver instances.
These timings do not measure user-visible pacing or imply a table-wide speedup, because the host can wait for a configured minimum delay and most time is spent earlier in the deal.
