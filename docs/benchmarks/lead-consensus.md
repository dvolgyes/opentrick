# Two-batch opening lead consensus

## Frozen exploratory protocol

Run all 96 complete deals once using seeds 12100000–12100095, with board numbers `2 * floor(i/4) + i%2 + 1` and alternating competitive NT, competitive suit, weak partscore and moderate partscore slots as in `opening-optimizer.ts`.
Use the isolated `b2858bff0de6c3509e527f5aadfed7a34c2c3aa3` engine and fixtures, a single pinned CPU, and no holdout tuning, replacements or early stopping except on invalid measurement.

Use two separately seeded 2500 ms opening searches (5 s nominal total), with batch order alternating by board parity and no fixed layout count, so counts can differ.
Expose only the real accumulated layout weight from the isolated opening evaluator and weight each batch's card means by that sum, not by sample count or effective sample size.
Both controls and the candidate see those exact same batches: the two-batch incumbent takes the merged winner, the holding-specific control takes the standard partner-major lead if within 1 IMP of the merged winner, and consensus takes that same suggestion only if within 1 IMP of the winner in each batch.
If advice abstains or a gate vetoes it, use the merged winner; use the engine's utility, expected duplicate score, rank and legal order tie breaks.
These are matched two-batch controls, not an untouched single-stream 5 s incumbent or a live latency measurement.
Use the same eight-layout continuation policy, hints and per-position random stream initialization for all branches and replay each distinct lead once.

Record every deal's identity, opening evaluation vectors, proposals, gaps, sample counts, engine elapsed time, table traces, and defender-signed raw duplicate scores before converting each paired difference to IMPs.
Require the two primary contrasts (consensus minus incumbent and consensus minus holding-specific control) each to have at least 20 non-ties, exact one-sided sign-test p < .025, and a one-sided 97.5% paired stratified bootstrap lower bound strictly above +.05 IMP/deal.
Resample 24 board differences with replacement within each of the four fixture slots, keeping the fixed mixture, for 10,000 deterministic bootstrap trials.
Report raw-score and IMP W/T/L, shared and duplicate leads, the full spread of timings and layout counts, and all board rows; a duplicate deal or any incomplete measurement invalidates the gate.
Passing requests a separate full-timed confirmation, never live promotion; failing is not evidence of equivalence or harm.

## Reproduction and preflight

Archive the named commit to a temporary checkout and make the repo's installed lockfile dependencies available there.
Use the secured optimizer arena in the temporary checkout, whose only change from that commit is exporting the existing `playTable` function with a doc comment, then copy `scripts/self-play/lead-consensus*.ts` into the temporary checkout.
The opening harness uses the already-installed `esbuild` from the `tsx` toolchain to load an in-memory copy of the kernel exposing `weightSum` at the snapshot boundary; it does not edit the engine on disk.
Run `taskset -c 11 node --import tsx scripts/self-play/lead-consensus.ts --check` to compare eight-layout results with the untouched engine in four separate development fixtures (seeds 1736–1739).
The four development fixtures matched the untouched engine for both batches, and the eight-layout unweighted comparator returned weight sum exactly eight in every batch.
The five focused unit checks passed for inconsistent batches, threshold equality, abstention and weight pooling, invalid inputs, and same-lead replay deduplication.
The initial archive needed the secured arena export and the workstation Node binary lacked native type stripping, so these setup attempts failed before any holdout row was scored.
Run `taskset -c 11 node --import tsx scripts/self-play/lead-consensus.ts > result.jsonl` for the holdout.
The measured engine SHA-256 is `53c7ec2e4bca0ce82e30e280f53331b5eab070e1f682fcfd0bcea657a326a927` and the arena SHA-256 is `4e02c18cd175581448831bd92e4355cf1d249f016e442f3bf169f4666bfdf052`.
The timed entrypoint SHA-256 is `695aee7c05be4e33d1ad17014d31a7db9aad52128697f85cd7764f492907f37d` and the consensus policy SHA-256 is `41f6ab3f0e319f9299650edd1834829883a3c57dfaaae8da769a8654cd17186a`.
The evaluator used bridge-dds 1.4.0 and esbuild 0.28.2.

## Holdout result

The run completed all 96 distinct deals with 24 in each fixture slot and no invalid rows, using Linux x64, Node 22.22.1 and an AMD Ryzen 7 4800H pinned to logical CPU 11.
Under the frozen gate, consensus failed both comparisons; do not advance to confirmation or change production.
The controls use the matched two-batch aggregate, not one uninterrupted 5000 ms incumbent search, so the result does not measure any differences due to splitting the clock or resetting the search.

| Paired contrast | IMP W/T/L | Net IMPs | IMP/deal | 97.5% lower | Sign p | Raw W/T/L | Net raw points |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Consensus − matched search | 7/85/4 | +19 | +0.198 | −0.271 | .2744 | 7/85/4 | +1360 |
| Consensus − matched holding-specific | 1/94/1 | −9 | −0.094 | −0.375 | .7500 | 1/94/1 | −620 |

Advice was unavailable on one board and proposed a different lead from matched search on 61 boards.
The holding-specific control changed the lead on 59 boards; consensus changed it on 56.
The consensus veto mattered on only three boards: it cost 12 IMPs on seed 12100033, tied on 12100067, and saved 3 IMPs on 12100085.
Thus the only expensive veto swing observed made the result worse, but the low number of non-ties does not establish a general harm or benefit.
Consensus shared 40 opening cards with matched search and 93 with the holding-specific control; 37 boards required one distinct table and 59 required two, for 155 total.
The exploratory direct holding-specific minus matched search contrast was **+28 IMPs**, IMP and raw W/T/L both **8/83/5**, and **+1980 raw defender points**; each board's raw difference was converted directly, not computed by subtracting the two primary IMP contrasts.

| Timing/layout quantity | Minimum | 25th percentile | Median | 75th percentile | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Two-batch opening elapsed (ms) | 5003.2 | 5044.3 | 5096.8 | 5216.6 | 6840.9 |
| Individual batch engine elapsed (ms) | 2500.1 | 2513.2 | 2539.8 | 2595.4 | 4210.6 |
| Two-batch opening samples | 37 | 82 | 108 | 150 | 396 |
| Individual batch samples | 11 | 41 | 56 | 74 | 219 |
| Absolute difference in samples between batches | 0 | 7 | 13 | 20 | 70 |

The nominal deadline is checked between layouts, not a hard stop inside a DDS solve, and the maximum observed combined elapsed exceeded it by 1.84 s.
All hands, fixtures, continuations and summaries together took 645.27 s wall, 639.52 s user and 0.86 s system.
[Compact JSONL](lead-consensus.jsonl) includes every board's complete table card traces, root utility/expected-score vectors, timing, samples, normalizers, gaps, proposals and choice scores.
The score and choices arrays are in matched search, holding-specific, consensus order; table traces concatenate two-character cards; each pair of IMPs is consensus minus matched search and consensus minus holding-specific.
The compact rows were checked against the prescribed schedule, 96 unique deal hashes, complete distinct table traces, score polarity and mapping, one-sided sign probabilities and independently recomputed paired IMP totals.
The original full JSONL is at `/tmp/opentrick-consensus-results.jsonl` with SHA-256 `03a045599c79f571d2cf7dae985474f4836392b50655e5ce0ed761a138ca1054`.
