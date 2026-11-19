# Card search: work, accuracy and play

## Protocol

Use `eb18b5e5657d5468faeb715f648be4f2678a87e2` as the incumbent.
Do not change bidding, the information available to either partnership, or the IMP objective.
The unit of a strength comparison is a complete pair of rooms on one deal, not an individual card.

1. Compare fixed-work search on 48 fresh deals starting at seed 7310000.
   Take one position per deal, cycling through plies 0, 12, 24 and 38 and across the five strains.
   Use eight layouts per decision, identical random streams and separate DDS instances.
   Require the same selected cards and all per-card numerical evaluations for each position.
   Count all accumulator lookups and DDS calls.
   For timing, warm both engines and alternate their order over four paired passes; retain every pass, including regressions.
   Accept an implementation as a speed improvement only for a regime in which the measurements support that claim.
2. Compare the former engine against the revised engine with the same IID budget on 32 complete boards from seed 7410000, at four layouts per non-forced play.
   Require identical card traces and duplicate scores in both rooms, not merely zero net IMPs.
3. Test small-layout enumeration against an independent exhaustive assignment and DDS calculation in 96 generated endings from seed 7510000, cycling through plies 40 to 47.
   Record forced positions and populations above the limit; do not count either as evidence of increased accuracy.
   On the qualifying two-hand populations of 2–64 layouts, require all candidate values to equal the exhaustive reference within numerical roundoff.
   Compare the current IID estimate at the same number of DDS calls on those same positions.
   Reject enumeration on any omission, duplicate layout, illegal card or incorrect value.
   Verify separately that auction weights still apply and that an interrupted traversal does not start with a fixed preferred layout.
4. Compare bounded enumeration to IID by playing out 256 paired endings from seed 7610000, each from ply 36 at a ceiling of 16 layouts per choice.
   Report net IMPs, wins, losses, ties and uncertainty regardless of sign.
   Treat these results as a strength diagnostic, not proof about full games or the deployed time budget.
   The mathematical acceptance criterion for enumeration is exact evaluation of the existing weighted objective with no redundant DDS calls when the population fits.

Use a second, ongoing experiment for opening-lead treatments.
Restrict changes to legal leads tied on duplicate score and IMP utility.
Run side-swapped full boards and separate screening deals from holdouts.
Keep all results exploratory; repeated looks at a running study do not authorize promotion to live play.
Do not infer a partner's signal from a convention that partner has not agreed to use.

## Same-budget control against the historical engine

On 48 positions every concrete card and numerical evaluation matched the old engine exactly.
Both engines made 376 DDS calls on identical layouts; the optimized engine made 2,464 score lookups instead of 3,144 (21.6% fewer) and eliminated all 6,016 hand sorts in the adapter.
On all 32 complete side-swapped boards both rooms played identical 52-card traces and returned identical duplicate scores.

| Warmed pass | Old, seconds | New, seconds |
| --- | ---: | ---: |
| 1 | 9.113 | 9.028 |
| 2 | 8.828 | 8.928 |
| 3 | 9.353 | 8.648 |
| 4 | 8.756 | 8.640 |

Searches at plies 24 and 38 were faster on each pass, but one full batch regressed.
Opening leads accounted for most measured batch time; the timings do not isolate the native DDS call.
The result establishes less repeated work, not a uniform wall-clock speedup.
The [historical control](historical-search.jsonl) records the layouts' digests, phase timings and concrete board traces.
To reproduce, extract `package.json` and `src` from the incumbent Git revision into a trusted local directory, link its `node_modules` to the installed project dependencies, and run `node --import tsx scripts/self-play/search-control.ts /path/to/snapshot`.

### Auction-informed decisions

The [auction-weight comparison](auction-weight.md) tested 48 additional positions with bidding evidence, including repeated hints and all six point scales.
Over 1,536 sampled worlds, the optimized engine reproduced the historical layout stream and complete analysis bit-for-bit.
Preparing public play history once per decision reduced history inspections by 99.4% and point counts by 53.6%.
In the final isolated analysis-loop benchmark, the median hinted run took 43.5% less time with a cheap fixed solver.
That figure is not a DDS or full-game speedup.

## Small endings

On the 96 accuracy deals, 14 decisions were forced and 23 had only one hidden allocation.
All remaining 59 positions qualified; 12 had legal cards with different oracle IMP values.
Exact search matched every card's expected tricks, duplicate score, success probability and IMP utility, as well as the full ranking, on all 59.
At the same DDS-call count, IID search matched 57 full rankings and 58 selected cards.
It incurred no positive oracle IMP regret on these deals: the different selected card tied on utility.
Its mean per-position maximum error across cards was 8.53 duplicate points and 0.111 tricks, versus zero for enumeration.
These are errors against the existing PIMC objective, not against human play.

In 256 side-swapped endings, the policy with cutoff 16 used 17,668 DDS calls against 31,433 for IID (43.8% fewer across its decisions).
It won two boards, lost two and tied 252, for −2 IMPs total (−0.008 per deal).
The fifth and 95th percentiles from resampling paired boards were −0.039 and +0.023 IMP/deal.
This supports removing repeat solves, not a claim that the engine wins more boards.
The [ordered results](ending-search.jsonl) retain every accuracy trial and every paired IMP contrast.
Reproduce with `node --import tsx scripts/self-play/ending-control.ts`.

The [cutoff comparison](ending-frontier.md) then tested 256 against 64 on fresh positions and paired deals.
It passed the preset accuracy, clock and work checks; the live cutoff is 256.

## Opening leads

The first screen compared five concrete opening-lead choices on twelve common full boards, seeds 1100000000–1100000011, at three layouts per searched decision.
All 60 paired comparisons finished.
Fourth-highest from the longest suit at no-trump, low from the longest suit and a non-trump singleton each tied the incumbent on all twelve boards.
Top of a sequence and the combined sequence-or-shape treatment each won one, lost one and tied ten (−8 IMPs).
None advanced from this screen.
This tests leads only, not whether partner could profit from a matching inference agreement.

The ongoing study gives a positive screen winner fresh holdout deals and keeps the result separate from the screen.
Neither a screen nor a repeatedly inspected holdout can change the live ranking.
Use a fresh, private checkpoint directory on Linux:

```sh
nice -n 15 node --import tsx scripts/lead-study.ts --checkpoint "$HOME/.local/state/opentrick-lead-study"
```

The study uses one serial worker and checkpoints each pair.
Interrupt it with `Ctrl-C` or `SIGTERM` and rerun the same command to resume; `--pairs N` runs a bounded batch.
A changed engine or protocol requires a fresh directory.

In the ongoing study's first holdout, low from the longest suit won two boards, lost two and tied 60, for −5 IMPs on fresh seeds 1700000024–1700000087.
The screen result did not carry over; the production lead policy stays unchanged.

### Does partner benefit from decoding fourth-highest?

The [agreed-lead experiment](agreed-lead.md) separately tested the cost of sending the signal and the value of receiving it on 48 full 3NT boards.
Both members of the experimental partnership knew the same agreement; neither declarer nor an unagreed partner received hidden information.
Always sending fourth-highest gained 13 IMPs against the incumbent (11 wins and 11 losses).
Conditioning partner's samples on the rank message lost 21 IMPs against the same sender without decoding.
The complete agreement lost 5 IMPs against the incumbent; separate pairwise IMP contrasts need not add because the IMP conversion is nonlinear.
All games finished, but the screen failed its prespecified gate: no confirmation run and no live convention change.
