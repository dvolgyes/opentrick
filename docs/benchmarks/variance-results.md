# Hidden-hand sampling variance results

The [protocol](variance-protocol.md) set the cohorts, budget, and decision rule before these runs.
The runner used Node 22.22.1 and `bridge-dds` 1.4.0 on Linux x64.
At launch, the engine, sampler, DDS adapter, card knowledge, arena, and reference enumerator matched `b2858bff0d`.
The runner wrote a temporary copy of the engine with one sampler parameter and removed the copy after import.
The production engine, production sampler, and DDS adapter were not changed.

## Oracle comparison

Each cohort contributed one active position from each of its first 144 deals, for 576 paired searches per candidate.
Each search used eight DDS calls.
The independent reference enumerator produced the same legal layout set as production enumeration at every selected position.
The two reference evaluation orders agreed to within `1e-9` IMP per legal card.
Auction weights were nonuniform at 10 antithetic positions and six stratified positions.
The two cohorts use independent deals, so compare each candidate only with its own IID baseline.

| Candidate | IID MSE (IMP²) | Candidate MSE (IMP²) | MSE gain | 97.5% lower | IID regret (IMP) | Candidate regret (IMP) | Regret gain | 97.5% lower |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Antithetic | 0.496864 | 0.408598 | 0.088266 | -0.003790 | 0.018239 | 0.016647 | 0.001592 | -0.003349 |
| Stratified | 0.594344 | 0.381547 | 0.212797 | -0.000941 | 0.005996 | 0.000220 | 0.005776 | 0.001240 |

The gain is IID minus candidate.
The confidence bounds resample deals, not the four searches within each deal.
Neither candidate passed the MSE gate.
Antithetic sampling also failed the regret gate.
Stratified sampling lowered regret on its cohort by the prespecified criterion.

| Candidate | Excluded positions: forced / exact / too large / visibility | Oracle positions with ties | Equal selections | Equal regret | Search ties: IID / candidate | Oracle-optimal: IID / candidate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Antithetic | 168 / 15 / 684 / 0 | 106 | 528 | 542 | 453 / 462 | 538 / 536 |
| Stratified | 190 / 11 / 708 / 0 | 110 | 546 | 558 | 474 / 462 | 558 / 574 |

Antithetic population counts by layout count: `10:1, 15:1, 21:8, 28:4, 35:3, 36:4, 56:19, 70:6, 84:21, 120:9, 126:68`.
Stratified population counts by layout count: `10:1, 15:1, 20:2, 21:6, 28:4, 35:6, 36:5, 56:21, 70:7, 84:14, 120:9, 126:68`.

## Paired games

The two rooms used the same budget rule at every position.
The total DDS calls can differ when the rooms reach different positions.
Each arm made 4,992 choices per cohort, including forced plays.
Both rooms selected the same opening lead on all 192 boards.

| Candidate | Paired boards | Wins / losses / ties | Total IMP | IMP per board | 97.5% lower |
| --- | ---: | ---: | ---: | ---: | ---: |
| Antithetic | 96 | 25 / 31 / 40 | -26 | -0.270833 | -1.052083 |
| Stratified | 96 | 28 / 36 / 32 | -6 | -0.062500 | -0.916667 |

| Candidate | Arm | Forced play | Unique layout | Exact | Active sampling | Opening IID | DDS calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Antithetic | IID | 1,053 | 174 | 453 | 3,216 | 96 | 28,492 |
| Antithetic | Candidate | 1,048 | 205 | 416 | 3,227 | 96 | 28,467 |
| Stratified | IID | 1,047 | 220 | 394 | 3,235 | 96 | 28,379 |
| Stratified | Candidate | 1,030 | 181 | 434 | 3,251 | 96 | 28,620 |

The oracle and game deals are disjoint for each candidate.
The game cohorts use generated deals and a fixed rotation of game contracts, not observed auction distributions.
Neither candidate passed the MSE or paired strength gate.
There is no live strength claim, no confirmation run, and no production change.

## Reproduction

The [measurement ledger](variance-measurements.jsonl) records the oracle trials and paired scores.
The commands below also emit both rooms' complete card traces.

```sh
node --import tsx scripts/self-play/variance-run.ts antithetic oracle
node --import tsx scripts/self-play/variance-run.ts antithetic games
node --import tsx scripts/self-play/variance-run.ts stratified oracle
node --import tsx scripts/self-play/variance-run.ts stratified games
./node_modules/.bin/vitest run tests/unit/variance-sampling.test.ts
```

The initial test failed because the candidate module was absent.
The first implemented test run exposed a fixture that applied the antithetic overlap assertion to an exact-path position.
The corrected fixture checks sampled positions with unequal capacities and forced cards, without changing the candidate or the benchmark cohorts.
The focused suite also checks exclusions, the stratified rank marginals, and stratified samples against the independent enumerator.
The theoretical marginal claims assume a uniform permutation or offset.
The antithetic runner uses the baseline Fisher–Yates random-index mapping to preserve the same first layout for a common seed.
