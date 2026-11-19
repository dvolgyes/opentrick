# Paired card self-play

## Selection protocol

The objective is positive duplicate IMPs against the incumbent card player, not agreement with a double-dummy oracle.
Each deal starts with the same contract, vulnerability, cards and prefix in both rooms.
The challenger plays North–South in the first room and East–West in the second.
The deal result is the IMP value of the difference between the two signed North–South scores.
Each policy gets only the acting player's permitted position, with a fresh deterministic search stream per board, ply and actor.
Neither the deal generator nor an actual hidden hand is a policy input.

Compare these two changes separately to the incumbent ranking:

- `cash`: only among exact ties on both expected IMPs and duplicate points, prefer a master card on lead or winning the trick for the partnership in fourth seat.
- `contract`: rank by make/set probability, breaking ties with the incumbent ranking.

Screen both on the same 160 deals starting at seed 310700, with six sampled layouts per non-forced decision and a shared random legal prefix of 24 cards.
Use all five strains in rotation with the normal dealer and vulnerability cycle.
Random prefixes reduce cost and do not represent expert play.
Do not discard tied boards, failed searches or adverse deals.
A search that cannot finish its sample budget invalidates the run, except for a forced decision or a known unique layout.
Advance at most one candidate with positive net IMPs and more wins than losses: highest mean IMPs, then `cash` on a tie.

Confirm that candidate without retuning on 320 new deals starting at seed 912400 under the same conditions.
Require at least 20 non-tied deals, a one-sided 95% paired-deal bootstrap lower bound above +0.05 IMP/deal, and a one-sided exact sign-test probability below 0.05.
There is one confirmation, not a new holdout for each failed candidate.
A successful confirmation establishes a gain only in the tested regime.
Before changing the default ranking, require corroboration on full boards at the deployed time budget, using the same gates on 160 new deals starting at seed 1810600.
Otherwise retain the incumbent.
No result establishes globally optimal play.

A decision-preserving shortcut has a different acceptance rule.
Require a card-order or hand-allocation proof, tests of its counterexamples, and a side-swapped self-play control against the incumbent.
Require identical traces and scores, and fewer actual DDS calls, on fresh boards in that control.
This permits a computational improvement, not a strength claim.

## Separate bot-carding experiment

The first screen tested how to rank cards; this experiment instead tests what a bot can infer from observed play.
Under the incumbent policy, a bot holding two adjacent ranks of the same suit cannot play the higher while it still holds the lower.
Swapping the two cards preserves all comparisons in every possible layout, and the incumbent breaks that tie in favor of the lower rank.
Consequently, after a bot plays the higher rank, that bot cannot own its still-unseen lower neighbor.
Do not apply this inference to human cards, random prefixes, or other bot policies.

Compare this one new hypothesis to the incumbent from the opening lead on 80 deals starting at seed 512300, search seed 93371, four layouts per non-forced decision.
Advance only on positive total IMPs and more wins than losses.
If it advances, confirm without retuning on 160 full deals starting at seed 646100 and search seed 73019.
Use the same minimum of 20 non-ties and lower bound above +0.05 IMP/deal as above, with a stricter one-sided sign-test threshold of 0.025 for this additional experiment.
A pass can support this policy only for known low-card bot opponents at this budget.
Do not infer card ownership in live games without reliable provenance for each observed play.

## Results

| Candidate | Run | Deals | Wins / losses / ties | Net IMPs | IMPs/deal | Lower 95% bound | One-sided sign p |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |
| Make/set probability | Screen | 160 | 0 / 0 / 160 | 0 | 0 | 0 | 1 |
| Cash winners | Screen | 160 | 14 / 11 / 135 | +11 | +0.069 | −0.100 | 0.345 |
| Cash winners | Holdout | 320 | 26 / 22 / 272 | +3 | +0.009 | −0.119 | 0.333 |
| Bot-carding inference | Screen | 80 | 22 / 16 / 42 | +30 | +0.375 | −0.288 | 0.209 |
| Bot-carding inference | Holdout | 160 | 43 / 28 / 89 | +85 | +0.531 | +0.119 | 0.048 |

None qualified for live play.
`contract` did not change a single trace in its screen.
`cash` did not clear either confirmation threshold.
`carding` cleared the mean-IMP threshold on new full boards but missed its prespecified sign-test threshold of 0.025.
It remains a research candidate, not a default.
No production-time-budget strength test was triggered.
The exact sign test asks whether wins outnumber losses among non-ties; the mean-IMP bootstrap measures the size of the swings and includes ties.
The lower bound is the fifth percentile of 10,000 seeded resamples of whole paired boards.
The observed zero for `contract` does not rule out differences on other deals or budgets.

### Accepted search changes

Compared with the card player at `a0d3ee131b9e5271d68a1a654185c3092eebacb6`, both rooms played exactly the same 52 cards on each of 40 fresh deals.
Across the same 2,080 decisions, the old engine made 6,624 DDS calls and the optimized engine made 5,695, a reduction of 929 (14.0%).
At four samples per decision, 194 multi-card equivalent choices removed 776 calls and 51 unique layouts removed 153.
A forced card already used no solver calls in the old core.
These are solver-call counts at a fixed sample budget, not a wall-time estimate or a strength gain.
The natural live pacing and the number of samples in timed searches can differ.

### Reproduce

The [evidence file](card-self-play.jsonl) records each protocol, ordered per-board triples `[scoreNS when candidate is NS, scoreNS when candidate is EW, IMPs]`, and a SHA-256 digest of each complete JSON Lines run.
The control records its card traces and solver-call counts per board.
Runs used Node 22.22.1 and the locked `bridge-dds` 1.4.0 on Linux x64 (AMD Ryzen 7 4800H).
The generated deals are unfiltered; contracts rotate through 3NT, 4♠, 4♥, 5♦ and 5♣ irrespective of fit, and no auction hints are supplied.
All policies, including the opponent, used the same cap on layout evaluations.
The benchmarks do not estimate strength against humans or at the five-second default.

```sh
npm run --silent benchmark:selfplay -- --candidate contract --deals 160 --seed 310700 --ply 24 --samples 6
npm run --silent benchmark:selfplay -- --candidate cash --deals 160 --seed 310700 --ply 24 --samples 6
npm run --silent benchmark:selfplay -- --candidate cash --deals 320 --seed 912400 --ply 24 --samples 6 --search-seed 866299
npm run --silent benchmark:selfplay -- --candidate carding --deals 80 --seed 512300 --search-seed 93371 --samples 4
npm run --silent benchmark:selfplay -- --candidate carding --deals 160 --seed 646100 --search-seed 73019 --samples 4
```

For the shortcut control, load the old evaluator and sampler from the pinned source, not from the optimized checkout:

```sh
snapshot=$(mktemp -d)
git archive a0d3ee131b9e5271d68a1a654185c3092eebacb6 package.json src | tar -x -C "$snapshot"
ln -s "$PWD/node_modules" "$snapshot/node_modules"
SNAP="$snapshot" node --import tsx --input-type=module <<'JS'
import { pathToFileURL } from "node:url";
import { checkShortcuts } from "./scripts/self-play/shortcut-control.ts";
const { analyzePlay } = await import(pathToFileURL(`${process.env.SNAP}/src/bot/play-engine.ts`));
console.log(await checkShortcuts(analyzePlay));
JS
```
