# Timed exact-search frontier: 256 versus 1024 layouts

## Frozen protocol

Test the cutoff on generated middle and late play with two hidden hands and no auction hints, leaving explicit-sample IID as the default.
The only engine change in the archived candidate is `MAX_ENUMERATED_LAYOUTS = 1024` instead of 256.
The baseline uses explicit cutoff 256 on the same engine, with no explicit sample cap for the timing comparison.

- Scan seeds `11300000 + i` and held-out `11400000 + i`, `0 <= i < 600` in each cohort, with board number `i + 1` and ply `20 + ((floor(i / 5) + (i % 5)) % 15)`.
  The arena rotates NT, spades, hearts, diamonds and clubs, then draws uniformly from legal prefix actions.
  Exclude forced moves and populations outside 257–1024; classify the upper exclusion with an independent enumeration stopped at 1025.
  Keep the first two eligible positions in each cohort, strain and cardinality band (257–480, 481–750, 751–1024); keep all scans and exclusion statuses in the raw data.
  Require at least 32 selected positions.
- The cheap preflight sees no DDS results or timings, and only its structural output is used to freeze the sample.
  The matched timing subset is the first selected position of each strain in the lower band of the first cohort, the upper band of the held-out cohort, and the middle band of either cohort when present.
  Run these matched searches in alternating baseline-first order by position index parity, with the same RNG seed for each policy and both using a real, uncapped default 5,000 ms budget.
  Record external wall time around `analyzePlay` and DDS call count, without the cost of position construction, independent enumeration, or DDS initialization.
  Require every candidate to complete the independent population in strictly less than 1,000 ms; every baseline must spend 4,500 to less than 8,000 ms and make more DDS calls than its matched candidate.
- Use real DDS and exhaustive independent legal assignments as the reference for each selected position.
  Compare the timed default and fixed-work candidate against all per-card expected tricks, duplicate score, success probability and IMP utility, with tolerance `1e-10` and full rank agreement.
  Check membership and uniqueness in the instrumented candidate and report fixed-work cutoff-256 IID errors against the same reference using exactly one sample per legal assignment in aggregate, drawn with replacement.
  The work guard is 60,000 ms, not the basis for runtime claims.
- Play 64 independent seeded endings from ply 32 (`11500000 + i`, board `i + 1`) in side-swapped rooms with matched explicit ceilings of 1024 DDS calls per choice, cutoffs 256 versus 1024, and the same 60,000 ms guard.
  Record every decision's ply, independent population (censored at 1025), actual DDS calls and chosen card, plus both complete room outcomes.
  Require valid complete work, some actual expanded exact searches, reduced total candidate DDS calls and no decisive negative strength signal (deterministic paired bootstrap one-sided upper 95% bound not below zero).
  Neither all ties nor passing this gate establishes improved or equivalent playing strength.

## Structural preflight

| Cohort | Forced | At or below 256 | Above 1024 | Eligible but stratum full | Selected |
| --- | ---: | ---: | ---: | ---: | ---: |
| 11300000–11300599 | 107 | 200 | 178 | 93 | 22 |
| 11400000–11400599 | 119 | 197 | 163 | 98 | 23 |

Of 1,200 scanned positions, 236 were eligible by population and choice count, of which 45 were selected before measurement.
They span plies 20–30 and all five strains, with populations of 330 (5), 462 (15), 495 (5), 792 (4) and 924 (16).
Fourteen positions qualified for matched timing.
The initial structural pass proposed eight matches from NT and spades; the frozen rule broadened that subset before any DDS score or timing was observed, without changing the 45 selected positions.
This is a cardinality-stratified sample, not a representative sample of live play or of all 236 eligible positions.
It does not exercise a population between 925 and 1024, auction-conditioned weighting, earlier play, slow devices or competing browser workload.

## Results

**Keep the live cutoff at 256.**
The candidate passed exhaustive agreement and saved substantial work in direct comparisons, but missed the frozen maximum-latency gate and never activated in the paired ending fixture.

The instrumented candidate visited all 29,007 reference layouts exactly once across 45 positions; the timed candidate also completed all 29,007 solves.
Both candidate analyses matched every reference metric exactly and matched the full ranking in all 45 positions.
The fixed-work IID baseline solved 29,007 layouts including repetitions (18,391 distinct layouts within positions), matched the oracle's card in 42/45 and its full ranking in 41/45, and incurred positive utility regret in 3/45 (mean 0.000361 IMP across all positions).

| Maximum absolute per-card error | Candidate | Cutoff-256 fixed-work IID |
| --- | ---: | ---: |
| Expected tricks | 0 | 0.339394 |
| Expected duplicate score | 0 | 35.818182 |
| Success probability | 0 | 0.043290 |
| IMP utility | 0 | 0.506494 |

External candidate wall time was 102.3–1,241.9 ms (median 256.7 ms).
The one failure was seed `11300598`, a ply-22 diamond contract with four legal moves and 495 layouts, which completed in 1,241.9 ms against the fixed 1,000 ms gate.
The held-out maximum was 692.3 ms.
In the 14 matched comparisons (seven baseline-first), candidate times were 120.8–647.1 ms versus 5,000.1–5,002.1 ms for the baseline, and candidate DDS calls were 8,250 versus 159,767 (94.8% fewer in aggregate).
The baseline performed more solves in every match, by a factor of 6.06–42.92.

All 64 paired deals completed with valid work: 1,280 decisions and 28,010 DDS calls per policy, 0 wins, 0 losses, and 64 ties (0 IMP; one-sided upper bound 0).
No paired decision reached the new frontier: the largest population was 252 in either policy.
These pairs establish neither a strength difference nor strength equivalence for the newly exact range, and did not demonstrate work savings there.

## Reproduction

Archive baseline `b2858bff0de6c3509e527f5aadfed7a34c2c3aa3` into a clean directory and use its locked dependencies.
Change only the sampler's cutoff constant to `1024`; copy `scripts/self-play/expanded-frontier.ts` into the archive.
Run `node --import tsx scripts/self-play/expanded-frontier.ts --preflight` before running the same command without `--preflight` to generate the [raw JSONL](expanded-frontier.jsonl).
The measured environment was AMD Ryzen 7 4800H, Linux x64 kernel `7.3.5-1-liquorix-amd64`, Node `v22.22.1`, and `bridge-dds` `1.4.0`.
The [measurement manifest](expanded-frontier.sha256) records all archived source, fixture/oracle and DDS runtime hashes; parallel workspace changes were excluded.
The unmodified baseline sampler SHA-256 is `41dbc9207a6193eb8850cf18c4fde6c914620acf38694b20bda5f6fba5273882`.
The cardinality-only output SHA-256 is `65381ad10963238bf0cc3e8722e93946849b29d14e7b03d7fb8acbe2d42f8535`; it matches the run's first JSONL line.
The complete raw JSONL SHA-256 is `6ed0d83296341a1f08e29e8a9f51be63c155ed631bbeb4f929e09515c0235674`.
The checked-in driver (`1716539d8f8fd306485997a93bc59564a45a9e7c55413528510d1da512d14b3f`) was formatted and its imports reordered after the run; the manifest identifies the measured version.
