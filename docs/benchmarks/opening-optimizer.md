# Learning when to prefer partner's opening suit

## Question and controls

Previous [game](defensive-priors.md) and [partscore](partscore-leads.md) trials suggested that choosing partner's suit might matter more than following a particular rank convention.
They did not establish a stronger default.
The new experiment learns a rule from scored training leads, freezes it, and tests it on independently shuffled deals.
The incumbent and all alternatives see exactly the same public auction information.
There is no new partner signaling agreement.

## Frozen protocol

Epoch `e` starts at deal seed `1260000000 + 160*e`.
Train on the first 64 deals at four layouts per searched decision and evaluate on the next 96 at eight layouts.
Cycle equally through four existing fixture types: a competitive 3NT game, a competitive major-suit game, a major-suit partscore with a 0–3 point opening leader, and the same partscore family with a 4–7 point opening leader.
Use odd board numbers for 3NT and weak-leader partscores; use even numbers for the other two families, advancing by two every four deals.
Use the arena's per-decision random stream with the deal seed XOR `0x28f5b13d` as the table seed.
The two partnerships receive no original hidden hand as policy input.
A failed fixture or incomplete search invalidates the epoch: do not substitute another deal or score the failure as a tie.

Score each distinct proposed opening card in a complete table with the same subsequent incumbent play.
Take the final duplicate score from the **defenders'** perspective, regardless of direction.
A defender's policy acts only once on each of these boards; subtracting the corresponding complete table scores is the same comparison as swapping that policy in duplicate rooms.
Compute signed IMP differences **after** subtracting the raw scores.

Fit one rule for no-trump and one rule for suit contracts.
Each either retains the incumbent or leads partner's natural major with the rank chosen by search, holding-specific carding, or the highest card.
Search the maximum permitted estimated loss over 0, 0.25, 0.5, 0.75 and 1 IMP.
Choose the rule with the largest total training IMPs against the incumbent in that strain group.
On equal totals prefer fewer changed leads; then prefer the first rule in ascending margin order, with search rank before holding-specific rank before high.
The incumbent is the first option, so a rule with no measured training gain cannot displace it.
No holdout result enters fitting or the next epoch's training.

Compare each frozen rule on the full holdout with both the unmodified incumbent and the fixed holding-specific rule at a 1-IMP margin.
Report all wins, losses and ties, net IMPs, the one-sided board-bootstrap lower bound, and the exact one-sided sign test.
For nomination only, require at least 20 non-tied boards, lower bound above +0.05 IMP per board, and sign probability below `0.025/((e+1)*(e+2))` for **each** opponent.
The thresholds sum to at most 0.05 across both comparisons and all epochs.
Even a nomination needs a separate frozen match at the live time budget before adoption.
The learner never writes to the live engine.
An epoch with no nomination still leads to a fresh training and evaluation epoch.
The worker runs one match at a time; its epoch number is its replay cursor.

## Running and resuming

Run a single epoch with `node --import tsx scripts/opening-optimizer.ts 0 1 --rows`.
This writes one JSON record per training or holdout board, followed by the frozen rules and both comparisons.
Without `--rows`, the runner emits one summary per completed epoch.
`nice -n 15 node --import tsx scripts/opening-optimizer.ts 2` continues from epoch 2 on a single worker.
Save its standard output to a private JSONL file.
After interruption, use `nextEpoch` from its last complete summary; if the file is empty, restart the same epoch.
An interrupted epoch replays the same deals and contributes no second comparison.
Resume with the same source revision, Node version and installed dependencies.
Use a separate output file for a different engine revision.
There is no automatic deployment or automatic source-code editing.

## Independent training runs

Both runs used the `b2858bff0d` solver and card engine from an isolated source snapshot.
Epochs 0 and 1 used different deals for both training and holdout and did **not** share fitted parameters.
Every member of both 160-deal cohorts generated a valid fixture before scoring.

| Epoch | Learned no-trump rule | Learned suit rule | Training IMPs | Holdout vs incumbent (W/L/T; IMPs) | Holdout vs fixed standard (W/L/T; IMPs) |
| ---: | --- | --- | ---: | --- | --- |
| 0 | Search rank, margin 1 | Search rank, margin 0 | +33 | 3/0/93; +36 | 7/20/69; −43 |
| 1 | Incumbent | Search rank, margin 0.25 | +8 | 10/3/83; +22 | 8/8/80; −10 |

Both fitted policies gained against the incumbent but lost to the fixed holding-specific control on fresh deals.
Neither qualified for a live-budget test.
The trials completed 410 and 413 distinct opening-card continuations, using 102,087 and 102,587 DDS calls.
The [board-level ledger](opening-optimizer.jsonl) contains all training and holdout scores, selected policies, confidence bounds and sign probabilities.

### Exploratory comparison of the two controls

Scoring the fixed holding-specific lead directly against the incumbent gave +79 IMPs in epoch 0 (23 wins, 7 losses, 66 ties) and +32 in epoch 1 (18 wins, 11 losses, 67 ties).
Across those 192 holdout boards the mean was +0.58 IMP per board, with a one-sided 95% board-bootstrap lower bound of +0.24.
This comparison uses the two controls' raw defender scores before IMP conversion, not the difference between the two columns above.
It was selected after inspecting the results and uses only eight layouts per decision; it motivates an [independent five-second confirmation](standard-confirm.md), not a change to live play.
