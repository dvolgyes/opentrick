# Corrected HCP scoring control

## Protocol fixed before candidate timing

The incumbent is `b2858bff0de6c3509e527f5aadfed7a34c2c3aa3`; the candidate differs only in hand-point scoring for the controlled run.
Use one 13-card hand from each of 4,096 separate seeded shuffles from 11100000 inclusive, rotating N/E/S/W by seed, plus named edge cases and shuffled-order partial/empty hands.
Require exact raw, correction, total, and complete ordered explanations for every hand on all six scales in English and German.

Use 48 fresh positions from 11200000 inclusive, defined by the arena's seeded deal and legal prefix, with four samples per position and range hints on every hidden seat, including corrected HCP and ordinary HCP.
Require exact complete analysis except elapsed time and exact ordered sampled layouts under real DDS, with nontrivial weighted positions and unchanged sample counts.
Capture those real DDS scores, then time hinted analysis replaying the same scores without DDS work.
Report standalone DDS time and real-DDS hinted analysis time separately, without using either for the speed gate.
Play 16 full duplicate pairs from 11200100 inclusive under the same hinted policy, two samples per decision, with identical search streams in both rooms; require equal full traces, scores and trick counts, and zero IMP difference on every board.

Warm each variant twice before nine alternating-order paired rounds for isolated corrected HCP, ordinary HCP, and hinted analysis excluding DDS work.
Speed gate: median of candidate/incumbent paired time ratios below 0.85 for corrected HCP; ordinary HCP must not regress beyond 3% measurement tolerance and its scoring path must remain unchanged.
Retain the candidate only if correctness and isolated-speed gates pass; report the measured difference for hinted analysis, not an inferred whole-game improvement.

## Pre-change profile

Across the 4,096 hands, corrected HCP executed 16,384 suit-card sorts (`toSorted`), 4,096 shape sorts (`sort`), and 20,480 string joins; ordinary HCP executed none of those operations.
The three partial-hand regression tests passed on the incumbent before scorer edits.

## Results

**Accepted:** corrected scoring took 77.7% less time and hinted analysis replay took 45.9% less time, with no observed ordinary HCP regression.
The candidate executed zero suit sorts, shape sorts, or string joins in count-only scoring over the same 4,096 hands.
All six scales matched the pinned baseline exactly on the 4,096 full, 4,096 partial, and 15 named inputs, including complete ordered English and German explanations.
All 48 hinted positions matched, including all 192 ordered layouts, real DDS maps, chosen cards, effective sample sizes, and per-card numbers; 47 positions had nonuniform sample weights.
All 16 full duplicate pairs matched all 52 plays, scores, and declarer tricks, for zero IMP difference.
Both point unit suites passed (49 tests).

Each steady round timed 131,072 calls per isolated scorer and 768 hinted analyses with DDS results replayed.
The timings below are milliseconds on Node v22.22.1 and an AMD Ryzen 7 4800H.
The candidate scorer SHA-256 was `4988ffdf940b72823f9d8940b6c3ff2748d2a9b01d3f27b9943d2079d4667b01`.

| Round | Corrected HCP old / new | Ordinary HCP old / new | Hinted replay old / new |
| ---: | ---: | ---: | ---: |
| 1 | 878.33 / 190.33 | 47.05 / 42.58 | 117.12 / 76.93 |
| 2 | 838.63 / 192.17 | 40.39 / 41.89 | 101.90 / 53.84 |
| 3 | 807.36 / 187.09 | 41.52 / 40.23 | 88.36 / 48.50 |
| 4 | 815.97 / 186.15 | 40.99 / 40.71 | 88.51 / 47.78 |
| 5 | 836.05 / 188.42 | 37.93 / 42.34 | 87.46 / 50.92 |
| 6 | 837.52 / 186.83 | 39.24 / 35.71 | 87.72 / 47.44 |
| 7 | 822.89 / 182.24 | 40.67 / 35.69 | 88.70 / 45.19 |
| 8 | 844.36 / 183.67 | 39.49 / 37.98 | 87.62 / 45.33 |
| 9 | 830.31 / 181.42 | 39.33 / 39.42 | 85.96 / 47.90 |
| Median paired ratio (new / old) | 0.223 | 0.969 | 0.541 |

In the one-pass real-DDS correctness check, whole hinted analysis totalled 345.3 / 331.6 ms and DDS calls alone totalled 322.2 / 313.5 ms (old / new).
The 16 whole tables totalled 6186.8 / 6211.8 ms (old / new), so the isolated improvement does not establish a whole-game speedup.

## Reproduction

Run with Node and the repository's installed lockfile dependencies, using trusted snapshots only.
For a controlled comparison, extract the pinned commit into two temporary directories, link each snapshot's `node_modules` to the current installation, and replace only the candidate snapshot's `src/bridge/hand-points.ts` with the candidate scorer.

```sh
node --import tsx scripts/self-play/points-control.ts "$baseline" "$candidate"
```

The script emits all nine paired timings and fails on any correctness or speed gate.
The candidate accumulates suit lengths and honour facts numerically; each known shape is looked up by its suit-length histogram, independent of suit order.
The scorer visits corrections in the original display order and sorts a suit's cards only when it renders that suit's explanation.
