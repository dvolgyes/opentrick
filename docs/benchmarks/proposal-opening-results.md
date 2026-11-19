# Four-proposal opening leads: results

**Do not promote.**
The proposal scheme substantially improved utility estimates and effective sample size at equal DDS cost, but failed the preregistered paired-game confidence gate.
No default changed, and no realistic-time holdout was run because the three fixed-DDS gates were conjunctive.

## Mechanism and scope

The [preregistration](proposal-opening-preregistration.md) uses independent frozen portfolios of the same competitive fixture, evenly split into notrump and suit games.
Only the fixture's known human-seat HCP opening bid contributes a hint; calls with unknown provenance, including bot calls without provenance, do not.
Only the opening lead differs between arms; subsequent play uses incumbent search, with identical shared public hints and streams keyed by board, ply, and seat.
The independent reference uses random legal layouts, not the concealed board deal.
The separately reported actual-deal oracle uses that concealed deal only after the policies have picked their cards and after the independent reference has been computed.

For a mixed ordered pool, let $S=\sum_i w_i$ and choose $I$ with probability $w_i/S$; the conditional expected contribution of $(S/4)f(X_I)$ is $\sum_i w_i f(X_i)/4$.
For equal-weight pools the implementation selects the first proposal instead of a uniform index; equality holds conditional on the unordered pool by IID exchangeability, but not necessarily conditional on the ordered pool.
The normalizer is $S/4$ in either case, so the unconditional expected numerator and normalizer match the incumbent importance totals.
The ratio of those expectations targets the same utility, but the random self-normalized ratio is not generally unbiased at finite budget.
The exhaustive two-state test uses equal proposal probabilities, weights 1 and 3, and utilities 0 and 2; expected numerator and normalizer are 3 and 2, the one-query expected ratio is 1.3875 rather than 1.5, and accidental extra selected-weight multiplication would give numerator 9, normalizer 5, and ratio of expectations 1.8.

## Fixed-DDS reference accuracy

Forty-eight boards and four paired repeats gave 192 opening decisions per arm, each with eight DDS queries.
The 128-query IID reference per board was pooled from two independent weighted halves, with mean between-half utility MSE of 2.8841 IMP².

| Measure | Incumbent | Four proposals |
|---|---:|---:|
| Utility MSE against pooled reference (IMP²) | 11.6874 | 6.0841 |
| Utility MSE against reference half 1 (IMP²) | 11.9154 | 6.4557 |
| Utility MSE against reference half 2 (IMP²) | 12.9513 | 7.1845 |
| Mean effective sample size out of 8 | 3.9871 | 6.4098 |
| Mean pooled-reference regret (IMPs) | 0.3957 | 0.3500 |
| Mean actual concealed-deal DDS regret (IMPs) | 1.1719 | 0.6354 |
| DDS queries | 1,536 | 1,536 |
| Legal layout proposals | 1,536 | 6,144 |
| Summed opening search seconds | 137.46 | 133.74 |
| Median opening search milliseconds | 584.08 | 578.54 |

Relative MSE reduction was 47.94% (one-sided 95% paired-board bootstrap lower bound 35.81%), and ESS increased by 2.423 (lower bound +2.279), passing both gates.
Card choice changed in 132 of 192 repeats; board-mean MSE improved on 38 boards, worsened on 10, and tied on none.
Notrump MSE fell 36.42% with 7 of 24 board regressions, while suit MSE fell 56.20% with 3 of 24 regressions.
Notrump actual-deal regret decreased from 2.0208 to 0.8958 IMP, but suit actual-deal regret increased from 0.3229 to 0.3750 IMP.
The noisy reference maximum makes reference regret exploratory, and even true-deal DDS regret does not measure imperfect-information table results.
The reference used another 6,144 IID proposals and DDS queries in 476.90 summed search seconds; the actual-deal oracle used 48 DDS queries on known layouts.
Of 1,536 candidate proposal pools, 1,531 had differing weights.
The complete accuracy run took 115 wall seconds with eight shards, concurrent with the game run.

## Paired complete games

Ninety-six independent board pairs played both tables to completion at eight DDS queries per nonforced, nonunique decision.

| Fixture | Wins | Losses | Ties | Total IMPs | Mean IMPs | One-sided 95% lower bound |
|---|---:|---:|---:|---:|---:|---:|
| All | 15 | 12 | 69 | +12 | +0.1250 | -0.3646 |
| Notrump | 10 | 5 | 33 | +22 | +0.4583 | 0.0000 |
| Suit | 5 | 7 | 36 | -10 | -0.2083 | -1.0417 |

The fixed-DDS point estimate cleared +0.10 IMP, but the lower bound did not clear zero (one-sided sign test $p=0.351$).
There were 58 different leads, with 31 of those paired outcomes nevertheless tied; the 38 same-lead pairs had identical full play and scores.
The strain split is descriptive, not evidence for a narrower notrump-only policy.

| Work | Incumbent | Four proposals |
|---|---:|---:|
| Opening DDS queries | 768 | 768 |
| Opening proposals | 768 | 3,072 |
| Summed opening search seconds | 87.39 | 95.12 |
| Median opening search milliseconds | 828.51 | 755.35 |
| All DDS queries | 30,082 | 30,055 |
| All proposals | 30,082 | 32,359 |
| Summed search seconds | 264.65 | 277.98 |

Of 768 candidate opening pools, 766 had differing weights.
Distinct opening leads can alter later branching and how often play is forced, accounting for the divergence in later DDS counts despite the same continuation policy and budget.
Opening search work includes the generation and weighing of all four proposals, including the three discarded ones.
The game run took 83 wall seconds with eight shards; times reflect concurrent workloads and different selected DDS layouts, not a controlled latency improvement.

## Reproduction

Environment: AMD Ryzen 7 4800H, Linux x64, Node v22.22.1 and bridge-dds 1.4.0.
The launcher uses `git archive` to isolate the pinned code and uses installed dependencies; no generated engine is written into the working source tree.
Two analytic tests passed with `./node_modules/.bin/vitest run tests/unit/proposal-pool.test.ts`.
Every game and accuracy shard checked disabled-arm parity with the actual incumbent for missing hints and weights trivial because the hinted hand was already visible.
The separate archived controls initially traversed four first-legal replays without finding a nonforced unique layout; extending the deterministic legal-prefix sweep produced three known-layout and 110 nonunique continuation matches, with exactly one query at each known layout.
No project suite was run.

```sh
out=$(mktemp -d)
bash scripts/self-play/proposal-launch.sh accuracy "$out" 8 & accuracy=$!
bash scripts/self-play/proposal-launch.sh games "$out" 8 & games=$!
wait "$accuracy" && wait "$games"
node --import tsx scripts/self-play/proposal-summary.ts "$out" accuracy
node --import tsx scripts/self-play/proposal-summary.ts "$out" games

archive=$(mktemp -d)
git archive b2858bff0de6c3509e527f5aadfed7a34c2c3aa3 package.json src scripts/self-play | tar -x -C "$archive"
cp scripts/self-play/proposal-{engine,pool,controls}.ts "$archive/scripts/self-play/"
ln -s "$PWD/node_modules" "$archive/node_modules"
(cd "$archive" && node --import tsx scripts/self-play/proposal-controls.ts)
rm -rf "$archive"
```

The [raw records](proposal-opening-records.tar.gz) preserve all repeat-level card utilities, per-board reference halves, actual-deal oracles, both complete table trajectories, ties, scores, and timing and work counts.
