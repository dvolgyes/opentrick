# Hidden-hand sampling variance protocol

Freeze this protocol before any oracle or game result.
Use baseline `b2858bff0d`.
Keep the production engine unchanged.

## Comparison

Compare independent draws with an antithetic pair for positions with two unknown hands.
Shuffle the flexible cards once per pair.
Give the first hidden hand the first `k` flexible cards in one layout and the last `k` in the other.
Keep the known cards, forced cards, and capacities fixed.
Each layout has a uniform marginal distribution because each subset of size `k` occurs in the same number of permutations.
Use the original engine for scoring, auction weights, and card selection.
Change only the sampler for positions that neither enumerate within the budget nor have a unique layout.
Use eight DDS calls when sampling, all layouts when the population is at most eight, and no DDS call for a forced play.
Assert the expected DDS count for each choice.
Use a 60-second per-choice guard that fails the run instead of accepting a reduced budget.

## Oracle cohort

For each deal seed in ascending order from 10000000, examine plies 24 through 47 in ascending order.
Use the arena's deterministic random legal prefix and five-contract rotation, with board number equal to the seed offset plus one.
Choose the first position with two unknown hands, multiple legal actions, and 9 through 128 legal layouts.
Stop after 144 eligible distinct deals or fail if the first 10,000 seeds do not suffice.
Enumerate the reference by an independent depth-first allocation of unseen cards subject to capacities and observed voids.
Use the original engine's weights and IMP transformation on the complete reference population.
Compare the reference scores with production enumeration to within `1e-9` IMP.
Use search seeds 294721, 531809, 821413, and 993107 for each position, paired across arms.
Mean squared error is the mean squared deviation of estimated IMP utility from reference utility across all legal cards.
Regret is the best reference utility minus the reference utility of the selected card.
Average across search seeds within each deal before statistical analysis.
Report the populations, excluded deals, equal selections, decision ties, oracle-optimal selections, and the metrics for both arms.
Count differences within `1e-9` as ties for oracle reporting.

## Paired games

Play 96 boards from seed 10100000 through 10100095, with board numbers 1 through 96 and no prefix.
Use the arena's five-contract rotation and seat-specific search seeds derived from `seed ^ 0x65ea7c2d`.
Play each board twice and swap which partnership uses the candidate.
Interpret public calls using SAYC for all seats in both cohorts.
Compare the two North-South scores in IMPs, with positive IMPs favoring the candidate.
Report wins, losses, ties, IMP per board, and the number of decisions in each arm by sampler path.
Use the deal as the unit for all confidence bounds.

## Decision rule

Require all three one-sided 97.5% paired bootstrap lower bounds to be positive: baseline minus candidate for oracle MSE and regret, and candidate IMPs in paired games.
Use 10,000 paired resamples with seed 574309 and report the mean difference and lower bound for each metric.
The 97.5% level accounts for up to two candidate mechanisms.
A passing screen starts an independent fixed-budget confirmation at 192 full paired boards from seed 10400000 for antithetic or 10500000 for stratified sampling.
Use 256 layouts, including exact populations up to 256, and require the same positive one-sided 97.5% strength bound before considering a production change.
A failed screen cannot support a live strength claim or a production change.

## Independent alternative

If antithetic sampling fails the screen, test stratified sampling on fresh cohorts with the same protocol and budget.
Start the oracle cohort at 10200000 and the paired games at 10300000.
Number the legal combinations of flexible cards in lexicographic order.
To sample `m` ranks from `N`, choose one uniform offset from zero through `N - 1`.
Use ranks `(offset + floor(j * N / m)) mod N` for `j` from zero through `m - 1`.
These ranks are distinct because `N` exceeds `m`, and the random offset makes each rank marginally uniform.
