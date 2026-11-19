# Whole-board information-set UCB in duplicate bridge

## Frozen question

Does a general information-set UCB player beat the incumbent at a common short clock when each plays both declarer and defense from the opening lead through trick thirteen?
The earlier 3NT hold-up experiment cannot answer this question: it changed only one card choice in a narrow population.
This study neither trains nor evaluates a bidder.
No candidate receives the complete deal, the fixture's HCP or shape filter, or an auction likelihood.

## Contract matrix and paired play

Use 80 fresh boards, index `i=0…79`, seed `1720000000+i` for dealing and `1721000000+i` for search.
For each seed use the first qualifying arena shuffle, with no DDS selection of deals.
The board number is `i+1`; the standard dealer and vulnerability rotate, and the dealer declares.
The strain cycles through clubs, diamonds, hearts, spades, and notrump in that order, so each has 16 distinct deals.
The profile is `floor(i/5)`:

| Profiles per strain | Assigned contracts | Partnership HCP |
| --- | --- | --- |
| 0–7 | Levels 1, 2, 2, 1, 3, 2, 2, 2; use 2NT rather than 3NT in profile 4; double profile 6 and redouble profile 7 | 18–24 |
| 8–13 | 5 of a minor, 4 of a major, or 3NT, undoubled | 27–32 for minors, 25–31 otherwise |
| 14 | Small slam in the assigned strain | 30–34 |
| 15 | Grand slam in the assigned strain | 34–37 |

Suit-contract hands require at least eight combined trumps and at least as many trumps in declarer's hand as dummy's.
At notrump declarer must hold shape 4333, 4432, or 5332 and at least as many HCP as dummy.
This fixed coverage matrix includes deliberately uncommon contracts, especially redoubles and grand slams; it does not estimate the frequency-weighted performance of a tournament field.

Compare Plain against Base, Biased against Base, and Biased against Plain directly on each board.
For each comparison play two rooms: candidate North–South versus control East–West, then exchange the policies on the same deal and contract.
Alternate which room runs first by board parity and rotate comparison order by index modulo three.
Keep all 52 plays per room, the actual tricks, and the duplicate score; do not reuse timed decisions across rooms.
Use the arena's per-ply, per-controller stream, the common `obviousPlay` shortcut, and a uniform 100 ms search allowance at every other decision in each arm.
Base uses the current local card engine at `2de47f8466`.
Use warmed DDS instances, no sample cap for the timed match, and record overshoots of any uninterruptible native call.
This is a short-clock screen, not a five-second strength claim.

## Policy and information boundary

At every non-obvious move both trees draw hypothetical layouts from the acting controller's visible hand, exposed dummy when permitted, and public play history including voids.
Use one separate initial DDS layout to provide every legal root card with one estimated return in IMPs relative to the contract just made, from the acting partnership's perspective.
Sample a new layout for each subsequent tree simulation.
Tree decisions belong to the current controller only: declarer controls declarer and dummy; a defender does not control partner's hand.
Public continuations branch on actual card identities; after an opening lead also branch on the newly exposed dummy, independent of the order in which its cards were sampled.
Never use the actual concealed deal to select a card.

Within each simulation, complete the current trick and the following trick, or stop when no cards remain.
The native leaf scores the remaining tricks for the side on lead; convert to declarer tricks and signed duplicate IMP utility with the actual strain, level, doubling and vulnerability.
Other players are modeled by a fallible policy restricted to the acting hand and the public trick.
It leads from its longest suit (tie order S/H/D/C), using the top of a touching sequence headed by ten or higher, otherwise fourth-highest or low from a short suit.
It plays low if partner is winning, otherwise its cheapest winner, including a ruff or overruff, or low if there is no winner.
This model is intentionally the same in both trees.

Try unvisited actions first, ordered by the bootstrap estimates at the root and by low rank then S/H/D/C elsewhere.
Use the empirical mean with the root bootstrap observation plus the exploration term `6*sqrt(log(1+N)/n)` for visited actions, with real node visits `N` and real action visits `n`.
Only Biased also gives the model's suggested card `2/(1+n)` at each tree-controlled decision.
No heuristic forbids a legal card or merges later public histories.
At the deadline, choose the most visited root card, breaking ties by mean then public order; if there was not time to explore every card, choose the highest available mean, including the bootstrap.
An initial native call that exhausts the clock yields a bootstrap-only decision and must be counted as such.

## Scoring, stopping, and limits

For each direct match convert `candidate-NS room NS score − candidate-EW room NS score` once to IMPs, from the candidate's perspective.
Report W/L/T, mean and total IMPs across all 80 scheduled boards, and descriptive totals per strain and contract group.
The independent unit is the deal, not a card, a simulation or a room.
A subgroup is not a promotion test.
Use a common sequence of 20,000 bootstrap samples from `arena.random(0x42524944)`; for each sample draw 16 boards with replacement within each of the five strains.
Use the one-sided Bonferroni lower order statistic at zero-based index 333 for the three direct comparisons and the exact one-sided sign test on non-ties.
A qualifying comparison needs at least 20 non-ties, a sign probability below `0.05/3`, and a bootstrap lower bound strictly greater than +0.10 IMP per board.
Prefer Biased only if it qualifies against Base and Plain; otherwise Plain may qualify against Base.
If neither qualifies, keep the incumbent, report every contrast, and do not reinterpret a favorable subgroup as a win.
A passing screen nominates a policy for an independent normal-clock confirmation, not live adoption.
A missing, duplicate, off-schedule, or illegally replayed board blocks the decision; do not replace it or stop early based on its result.

## Execution and reproduction

The pre-run protocol above is archived as `frozen.md` (SHA-256 `e32963a4bc78a4c880602391b4909bc058ee73278694f790603d8ea9f7f9ff6d`).
The read-only snapshot covered the sources, the package and lock files, and the installed DDS and TypeScript loader dependencies (source manifest SHA-256 `e59f7a7aae2d6b2159590550a3165b2eff7a911d4d33f5f40f189f0f7e707d98`).
Seven Node 22.22.1 processes ran disjoint contiguous ranges on separate physical cores of a Ryzen 7 4800H.
Each process played its rooms sequentially; each partnership in each room got its own warmed solver.
Actual elapsed time includes the last synchronous solve, which cannot be interrupted by this Node runner.

With the locked dependencies installed, set `CPU` to an available logical CPU and run:

```sh
out=$(mktemp -d)
taskset -c "$CPU" node --import tsx scripts/self-play/mixed-run.ts 0 80 > "$out/mixed-ucb.jsonl" &&
  node --import tsx scripts/self-play/mixed-score.ts "$out/mixed-ucb.jsonl"
```

A timed rerun can complete a different number of simulations and need not produce the same cards.
Use the archived traces to reproduce this run's scores exactly.

The rank diagnostic is descriptive and does not affect the acceptance rule.
It compares the number of concrete choices at each searched root with the number of distinct public rank classes already recognized by the incumbent.
It also counts how often the selected card was not the lowest rank in its class.
These figures measure the opportunity to share estimates; they do not show that hiding the actual rank from partner or merging future public histories is safe.

## Whole-board results

All 80 deals and 480 rooms finished without substitutions.
None of the assigned deals duplicated any of the 256 earlier 3NT holdout deals or the 64 pilot deals.
An independent replay checked card ownership, follow-suit, winners, declarer tricks, and duplicate scores for all 24,960 plays.
The 384 suit-contract rooms included 827 tricks won by ruffing, 44 of them by overruffing.

| Direct comparison | Wins / losses / ties | Total IMPs | IMPs per board | Adjusted lower bound | One-sided sign p |
| --- | ---: | ---: | ---: | ---: | ---: |
| Plain − Base | 6 / 59 / 15 | −454 | −5.675 | −7.150 | 1.0000 |
| Biased − Base | 3 / 65 / 12 | −430 | −5.375 | −6.838 | 1.0000 |
| Biased − Plain | 21 / 22 / 37 | −42 | −0.525 | −2.013 | 0.6196 |

The sign probabilities test candidate *superiority*, not inferiority.
These are three separately played matches, not differences obtained by subtracting the other two rows.

| Contract subset | Boards | Plain − Base, IMPs | Biased − Base, IMPs | Biased − Plain, IMPs |
| --- | ---: | ---: | ---: | ---: |
| Clubs | 16 | −106 | −66 | −35 |
| Diamonds | 16 | −58 | −76 | −27 |
| Hearts | 16 | −54 | −91 | 0 |
| Spades | 16 | −132 | −89 | +27 |
| Notrump | 16 | −104 | −108 | −7 |
| Assigned low-level contracts (including X/XX) | 40 | −188 | −173 | −29 |
| Assigned undoubled games | 30 | −162 | −169 | +18 |
| Small slams | 5 | −64 | −47 | −11 |
| Grand slams | 5 | −40 | −41 | −20 |

**Decision:** neither tree qualified; retain the incumbent in every strain.
The fading carding bias did not improve on plain UCB in their direct match.
No five-second confirmation was triggered.
This rejects these two short-clock policies, not MCTS in general.

### Search behavior

| Policy | Searches (leads / later defense / declarer) | Native solves | Wall seconds in search | Longest call, seconds |
| --- | ---: | ---: | ---: | ---: |
| Base | 160 / 2,630 / 3,142 | 409,759 | 493.5 | 3.190 |
| Plain | 160 / 2,539 / 2,895 | 4,610,703 | 585.6 | 2.218 |
| Biased | 160 / 2,577 / 2,931 | 4,491,533 | 596.5 | 2.332 |

The trees completed 9,974,482 and 10,312,552 simulations respectively; terminal simulations did not require a native leaf solve.
Plain did not visit every root card in 252 of its 5,594 searches, including 91 that used only the initial DDS estimate.
The corresponding counts for Biased were 266 of 5,668, including 106 bootstrap-only decisions.
More simulations did not mean stronger play.
The opening and early native calls can overrun the common allowance, and Base can return early when its layout population is exhausted.

In Plain's 5,594 searched positions, 28,209 concrete legal cards formed 21,791 public rank classes: 22.8% fewer choices if scheduling exploration by class.
In Biased the corresponding counts were 28,148 and 21,831 (22.4% fewer).
Plain chose a non-lowest card from its selected class 838 times and Biased did so 878 times.
Base chose the lowest every time; its evaluator already shares estimates across these classes.
This is not evidence for indiscriminate pruning: the concrete card remains visible to partner and opponents.

### Scoring verification

Independent replay reproduced all three IMP totals, the five strain totals for each comparison, the bootstrap bounds and the eligibility decisions.
The independent duplicate-score formula also agreed with the engine on 23,520 combinations of contract, declarer, doubling, vulnerability and tricks.
The original shared sign-test routine returned `1.0000000000000016` for three wins and 65 losses because it accumulated the larger tail directly.
The corrected scorer computes the smaller tail and takes its complement when necessary.
Only floating-point sign probabilities changed on rescoring; neither cards, outcomes, bounds nor eligibility changed.
The archive preserves both summaries, the original statistics routine, and the independent integer-binomial check.

### Separate declarer play from defense

After the primary result, play one additional reference room per deal with Base in all four seats, using the frozen engine, clock, seed streams, and warm-up procedure.
Compare each candidate's original declaring room with that reference, and separately compare its defending room with the same reference.
The opponents remain Base in each role contrast.
The sign is always from the candidate's perspective: positive defensive tricks mean fewer tricks for the opposing declarer.

| Candidate role versus Base | Boards | Wins / losses / ties | Net tricks | Net IMPs | Net contracts made (declarer) or defeated (defense) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Plain declaring | 80 | 8 / 48 / 24 | −82 | −319 | −23 |
| Plain defending | 80 | 8 / 36 / 36 | −47 | −146 | −7 |
| Biased declaring | 80 | 6 / 48 / 26 | −89 | −327 | −21 |
| Biased defending | 80 | 7 / 39 / 34 | −52 | −121 | −4 |

Both roles lost ground, but the larger measured deficit was declarer play.
For example, on board 4 West declared 1♠: Base against Base took nine declarer tricks, Plain declaring took six, and Base declaring against Plain defense took eleven.
That cost Plain three tricks as declarer and two as defender; the trick count is always relative to declarer, not to North–South.
These are descriptive comparisons on the same boards, not independent confirmation or additional promotion tests.
Each role comparison converts its own score difference to IMPs; the two IMP totals need not sum to the primary comparison.
The independent checker replayed all 4,160 additional cards and reproduced the role totals.

### Replay the evidence

The [raw records, frozen protocol, and checkers](mixed-ucb-records.tar.gz) have archive SHA-256 `f3e3a708f2a899e62035f51f701682e25755e657b258cc9d2a3cb9a84187d3dd`.
From the checkout, replay the primary and reference rooms without repeating the timed match:

```sh
out=$(mktemp -d)
tar -xzf docs/benchmarks/mixed-ucb-records.tar.gz -C "$out"
node --import tsx scripts/self-play/mixed-score.ts "$out/mixed-ucb.jsonl"
node --import tsx --input-type=module - "$out" < "$out/verify-mixed.mjs"
node --import tsx --input-type=module - "$out" < "$out/mixed-ranks.mjs"
node --import tsx --input-type=module - score "$out" < "$out/mixed-roles.mjs"
```

To repeat the timed reference rooms, use `node --import tsx --input-type=module - play 0 80 < "$out/mixed-roles.mjs"` on a reserved CPU.
Do not replace the archived observations with a new timed run.
