# Timed exact-search frontier: 64 versus 256 layouts

## Frozen protocol

Run once with `node --import tsx scripts/self-play/ending-frontier.ts > /tmp/opentrick-ending-frontier-result.json`.
This study applies only to generated endings: one of five fixed contracts followed by uniformly drawn legal prefix actions, with no auction hints.
Do not infer live-game latency or strength from it.

1. Generate 160 fresh positions with seed `7710000 + i`, board `i + 1`, ply `30 + i % 10`, zero-based `i`.
   Classify each once in priority order: forced (one legal card), unique (one hidden layout), 2–64, 65–256, or >256 layouts.
   Use independent assignment enumeration, capped at 257 for classification.
   Only non-forced 65–256 positions qualify for reference scoring.
2. For every qualifying position, use real DDS to evaluate every legal card on every reference layout.
   For instrumented cutoff 256, require exactly one DDS call per distinct legal layout and identical ranked cards; compare expected tricks, duplicate score, success probability and IMP utility per card.
   Run cutoff 0 at the same number of DDS calls with IID replacement, using the same board seed for the search RNG; compare both modes against the same reference.
   Report card and full-ranking matches, maximum metric errors, and utility regret.
   Use a 60,000 ms guard for these fixed-work checks.
3. In a separate pass, call uninstrumented timed cutoff 256 for every qualifying position, with a separate DDS instance, no sample cap or progress callback and a 5,000 ms soft per-search budget.
   Record wall time around `analyzePlay` (not DDS initialization, position construction or independent enumeration), completed layouts and any truncation; report the median and maximum.
   Run this pass before the instrumented pass, in board order, without dedicated warmup.
   The hard acceptance gate is at least 12 qualifying positions, no errors (absolute per-card tolerance `1e-10`, with no ranking or traversal discrepancies), all measured traversals strictly under 500 ms, and no truncation.
4. Regardless of the first gate, play 128 fresh paired endings using seed `7810000 + i`, board `i + 1`, starting ply 32.
   Use the same seed for both swapped rooms through the arena; both policies cap work at 256 layouts, with cutoffs 64 (baseline) and 256 (candidate).
   Use a 60,000 ms guard so the comparison is fixed-work, not equal-time.
   Check actual DDS counts against independent populations and caps; check membership, exact-mode uniqueness, legal cards and completed rooms.
   Report both policies' DDS calls, both rooms' duplicate scores, the signed candidate-minus-baseline IMP distribution, wins/losses/ties and mean.
   Compute the one-sided upper 95% bound by negating the existing deterministic 10,000-resample board-level bootstrap lower bound on negated contrasts.
   Reject on any invalid work or if the upper bound is below zero.
   Passing does not establish a strength improvement or equivalence.

Recommend promotion only if both gates pass.
Do not tune the cutoff, subset, seeds, or thresholds on this run.

## Results

The single run completed on an AMD Ryzen 7 4800H, Linux x64 (`7.3.5-1-liquorix-amd64`), Node `v22.22.1`, with `bridge-dds` pinned to `1.4.0`.
Worktree base: `eb18b5e5657d5468faeb715f648be4f2678a87e2`.
See the [raw trials](ending-frontier.jsonl) for per-position timings and both rooms' North–South scores.

| Forced | Unique | 2–64 | 65–256 | >256 | Total |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 38 | 3 | 62 | 55 | 2 | 160 |

The 55 qualifying positions had 70–252 layouts.
Exact search visited each reference layout once, with no invalid layouts.
Both exact and IID used 8,162 DDS calls each, both chose the oracle's card and matched its full ranking in 55/55 positions, and neither incurred utility regret.
Exact matched all numerical evaluations; IID did not:

| Maximum absolute error | Exact | IID |
| --- | ---: | ---: |
| Expected tricks | 0 | 0.342857 |
| Expected duplicate score | 0 | 79 |
| Success probability | 0 | 0.100000 |
| IMP utility | 0 | 1.300000 |

Uninstrumented timed searches completed all 55 traversals, with **35.19 ms median**, **74.57 ms maximum**, and **zero truncations**.
The accuracy and timing gate passed.

| Paired policy | Forced | Unique | Exact | IID | DDS calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cutoff 64 | 920 | 257 | 1,104 | 279 | 86,628 |
| Cutoff 256 | 918 | 253 | 1,389 | 0 | 51,567 |

All 128 pairs had valid work.
The IMP distribution was 127 ties at 0 and one win at +10 (board 114, with North–South scores of +50 in the candidate-NS room and −400 in the candidate-EW room).
The candidate had no losses, gained 10 IMPs total, and averaged +0.078125 IMP per pair; the one-sided 95% upper bound was +0.234375.
DDS calls fell by 40.5%.
The paired gate passed.

**Recommendation: promote the timed cutoff to 256 under the frozen criteria.**
The evidence is numerical agreement, completion within the measured latency ceiling, and reduced DDS work in these generated endings.
IID made the same choices in the oracle comparison, and paired play produced only one non-tie; this is not evidence of a strength improvement, equivalence, or live-game latency.
