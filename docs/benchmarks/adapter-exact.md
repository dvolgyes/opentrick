# Exact DDS adapter comparison

Compare baseline `b2858bff0d` with split 7+6 rank encoding, sparse result decoding, and both changes together.
Use `node --import tsx scripts/self-play/adapter-exact.ts` with the installed `bridge-dds` package and its public `SolveBoardPBN` method.
Use 240 distinct deals from seeds 10300000 through 10300239.
Split the deals evenly into four stages with starting plies 0–3, 12–15, 28–31, and 44–47.
Cycle four partial-trick lengths and five strains per stage, and count actual leader rotations.
Compare every native argument by JSON bytes and every map entry by key, value, and iteration order.
Compare every map's keys with the legal cards from the engine.
Count rank probes and expansions per stage, including one 13-rank scan per reported baseline candidate.
Check malformed native ranks and masks against the baseline conversion behavior.

Run 24 paired full games on distinct deals from seeds 10400000 through 10400023.
Compare two complete legal traces per deal, with the baseline in both partnerships at one table and the selected adapter at the other.
Use perfect-information DDS for all moves and take the first highest-scored card in map order.
Compare card traces and exact scores.

Time all four variants in eight rounds on the same 240 inputs with public DDS calls and in sixteen rounds with stored DDS results.
Warm all variants before each timing series.
Rotate the variant order and reverse it on alternate rounds.
Repeat the stored-result corpus 80 times per timed round and consume map values and native inputs in a checksum sink.
Use the same adapter validation in both timing series.
Report individual paired round ratios, their median, and stage work counts.
Require exact equivalence, at least a 5% isolated median time gain, a gain in at least 13 of 16 isolated rounds, and less measured rank work.
Reject a candidate with a public roundtrip median regression above 3% or a roundtrip regression above 3% in seven of eight rounds.
If both individual changes pass, retain both only if the combination also passes and beats each individually by a median of at least 3%.
Otherwise retain the fastest passing individual change.
This protocol tests adapter cost on these positions and does not infer a full-solver speedup from isolated timing.

## Results

The run used Node 22.22.1, `bridge-dds` 1.4.0, and an AMD Ryzen 7 4800H on Linux x86-64.
All four variants passed native argument byte equality, legal key equality, and ordered map equality on all 240 positions.
All 84 combinations of boundary ranks and equal masks produced the same ordered maps as the baseline.

| Starting plies | Leader counts N/E/S/W | PBN rank scans | Split lookups | Output rank probes | Sparse scans |
| --- | --- | ---: | ---: | ---: | ---: |
| 0–3 | 15/15/15/15 | 3030 | 1920 | 3731 | 356 |
| 12–15 | 13/16/19/12 | 2310 | 1920 | 3120 | 300 |
| 28–31 | 15/14/16/15 | 1350 | 1920 | 2314 | 226 |
| 44–47 | 9/20/17/14 | 390 | 1920 | 1261 | 111 |
| Total | 52/65/67/56 | 7080 | 7680 | 10426 | 993 |

The output variant avoids 993 card string constructions and reduces output rank probes by 90.5%.
The split encoding variant uses 192 lookup entries but performs more lookups than the incumbent performs rank scans across this corpus.

Across all rounds, the baseline, encoding, output, and combined medians were 48.23, 51.96, 40.26, and 42.79 ms per isolated 19,200-position round.
Their roundtrip medians were 2408.38, 2461.34, 2215.62, and 2290.82 ms per 240-position round.

| Variant | Isolated median time change | Faster rounds | Roundtrip median time change | Roundtrip regressions above 3% |
| --- | ---: | ---: | ---: | ---: |
| Split encoding | +4.44% | 5/16 | −2.54% | 2/8 |
| Sparse output | −15.73% | 14/16 | −7.52% | 2/8 |
| Both | −12.91% | 14/16 | −3.06% | 0/8 |

The selected change is sparse output only.
The combination took 4.92% more isolated time than sparse output alone by the median paired ratio.
Roundtrip timing passes the regression gate but is too variable to support a solver speedup claim.
The installed sparse loop masks off bits outside DDS ranks 2–14 and checks the primary rank before shifting it.
The loop visits the least significant bit first to preserve low-to-high insertion order.
The deck lookup uses the rank index `14 - (31 - clz32(bit))`, which simplifies to `clz32(bit) - 17`.

Each sequence below is the percentage change from the baseline in paired round order.

| Series | Split encoding | Sparse output | Both |
| --- | --- | --- | --- |
| Isolated | −0.1, +4.5, +0.7, +20.9, −0.7, −1.8, +4.4, +1.9, −7.0, +7.4, +19.8, +23.1, +8.6, +44.2, −5.2, +9.0 | −19.4, −15.0, −19.3, +9.2, −13.6, −20.6, −20.7, −24.9, −23.4, +3.2, −21.1, −9.3, −8.7, −16.4, −11.2, −13.1 | −10.4, −15.0, −14.8, −5.6, −10.0, −15.1, −13.7, −21.9, −23.0, +29.4, −11.8, +3.8, −12.2, −15.0, −17.1, −1.9 |
| Roundtrip | −16.0, −27.4, −1.9, −3.1, −13.5, −1.9, +15.0, +11.8 | −26.4, −31.1, −1.3, −1.4, −16.8, −13.6, +14.3, +10.4 | −13.4, −25.6, −1.6, −2.9, −3.2, −8.0, +2.1, +2.1 |

The first run stopped before loading a candidate because this Node build does not support runtime TypeScript stripping.
The second run stopped before timing because the replay corpus stored native arguments over the adapter arguments.
The final timing run corrected those harness errors without changing the workload or the gates.

Run `node --import tsx scripts/self-play/adapter-exact.ts installed output` to verify the installed variant.
The installation gate rejected the incumbent before the production edit.
The first installed run found a missing terminal newline in the source equality check.
After restoring the newline, the installed variant matched all 24 paired 52-card traces and all 1248 ordered score maps.
Five focused DDS unit tests passed.
