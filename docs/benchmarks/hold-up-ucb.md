# Information-set UCB for the 3NT hold-up

## Frozen comparison

This experiment tests declarer's card play, not bidding, on 256 fresh balanced-opener 3NT games.
The 64 development deals suggested the ace control; none may enter the holdout.
The base engine is `c3dc025b9c`.
Use Node 22, the locked dependencies, and one logical CPU per worker without assigning two study workers to the same physical core.
Do not inspect partial results to adjust the policy, population, budget, or stopping point.
A failed or incomplete board blocks the evidence decision; do not replace it with another seed.

For index `i = 0…255`, start an independent arena PRNG at `1680000000+i` and keep the first shuffled deal with 15–17 HCP and shape 4333, 4432 or 5332 in North and 25–27 combined HCP in North and South.
Use board number `1+4*(i%4)` to keep North the dealer and cycle vulnerability.
Use the fixed notrump auction from `scripts/benchmark-notrump.ts`: North opens 1NT and declares 3NT, with an invitation for a responder below 10 HCP.
No arm receives auction weights, the generating HCP constraints, or the actual concealed holdings.
Check that all accepted deal fingerprints are unique and disjoint from the pilot, whose deal generator started at `46738000`.

Use incumbent play to reach the first eligible fourth-hand decision in the first three tricks, by declarer or dummy.
The acting hand must follow the led suit; its ace must be its only legal card that wins the trick for the partnership, and it must also be able to lose it.
Only this decision can differ between arms.
Use the same seeded eight-layout incumbent for all other decisions, skipping obvious plays; do not truncate the fixed workload silently.
Use the arena per-ply, per-actor stream derived from `1681000000+i`.
For the actual table, complete each distinct chosen card once and reuse its real score in arms that chose the same card.
If no fork occurs, finish the table once and count its score in all four arms.

| Arm | Policy at the eligible decision |
| --- | --- |
| Base | Production local search for 5,000 ms without a sample cap |
| Take | Play the ace immediately |
| Plain | Information-set UCB for 5,000 ms |
| Biased | The same UCB search with a fading hold-up bonus |

Use independent warmed solver instances for the three timed choices and rotate their execution order through the six permutations by board index.
Start timed arms with the same random seed, not shared mutable RNG state.
The deadline prevents starting a new simulation; a synchronous solve already in progress can finish after it.
Record actual elapsed time, not only the nominal limit.
The ace control gets the same maximum allowance but needs no search.

### Search under test

Sample each layout from the incumbent hand sampler constrained by the public history and the two visible hands.
Each simulation completes the current trick and searches the following trick.
Use UCB at each declarer or dummy decision before the cutoff, including moves after defenders reveal a card.
Only declarer and dummy make tree decisions; their remaining hands are fixed by the root and public sequence.
Each such node identifies a continuation by the public card sequence from this root, never by concealed card ownership.
Every legal card stays eligible, including a higher spot that ducks; try unvisited cards first, low rank first, breaking suit ties in S/H/D/C order.
Among visited choices maximize mean declarer IMP utility plus `6*sqrt(log(parent visits)/child visits)`.
The biased arm adds `2/(1+child visits)` only to the lowest duck at the root, only with 3–6 led-suit cards remaining across both visible hands, no visible king or queen in that suit in either hand, and both defenders following suit on the trick.
This is a hypothesis about a lone stopper, not a claim that ducking is correct.
Select the root card with the most visits, then the higher mean, then the same card order.

Defenders do not select actions from the tree: recompute their policy for each simulation from the acting defender's own sampled hand and public play, then branch the declarer tree on the card it observes.
On lead they choose their longest suit, leading the top of a touching honor sequence (ten or higher), otherwise fourth-highest or low from fewer than four.
When following, play the cheapest winner if partner is not winning, otherwise the lowest legal card; if there is no winner, play low.
At the horizon use native double-dummy tricks for the side on turn and convert to final declarer tricks, duplicate score, and declarer's signed IMP utility relative to making the contract exactly.
The leaf still assumes perfect information beyond the cutoff, and the simulated defender is an approximation of the actual incumbent defender.
An apparent gain over Base cannot be attributed solely to UCB; Biased minus Plain isolates the incremental policy change with timed-search variability.

### Acceptance and release boundary

Report all six paired contrasts: Take−Base, Plain−Base, Plain−Take, Biased−Base, Biased−Take, and Biased−Plain.
Convert the difference of the two actual North–South scores to IMPs **once per board**, then average across all 256 deals, including identity ties.
Report net IMPs, wins/losses/ties, make differences, work, and elapsed time.
For each contrast require at least 12 nonzero board IMP differences, a one-sided exact sign-test probability below `0.05/6`, and a one-sided Bonferroni board-bootstrap lower bound strictly above `+0.05` IMP per scheduled board.
Use 20,000 ordinary paired board bootstrap replicates, sharing indices from `arena.random(0x484f4c44)` across contrasts; take zero-based sorted index 166.
Prefer Biased only if it passes against Base, Take, and Plain; otherwise prefer Plain only if it passes against Base and Take; otherwise prefer Take only if it passes against Base.
If nothing qualifies, leave the production engine unchanged.
A qualifying result with eight-layout continuations is specific to that continuation policy; before changing the live default, require the same superiority contrasts to pass on independent deals with normal timed continuations.
Primary inference is restricted to this fixed 3NT population and decision; neither a negative result nor a positive one settles MCTS elsewhere in bridge.

## Execution and reproduction

The pre-run protocol above has SHA-256 `b788460462f5a5c3bfa50c1f53a715300a81c2a3ef95db5598d0937b2ce9a58b`; the evidence bundle includes its exact bytes as `frozen.md`.
The read-only snapshot included the playing code, the experiment, Node package and lock files, and installed DDS and loader dependencies.
Its sorted source manifest has SHA-256 `bcf682cedd51f081b97d4a3bad14a503b80c65bcd36f8084677d82c63f340c78`.
Seven single-threaded study processes used different physical cores on a Ryzen 7 4800H with Node 22.22.1.
Each process completed a disjoint contiguous group of indices, and the scoring step required all 256 in order.
Timed reruns can draw different numbers of layouts and select different cards; the archived rows are authoritative for this run.

To repeat with the locked dependencies installed, select one available logical CPU and write to a new output directory:

```sh
out=$(mktemp -d)
taskset -c "$CPU" node --import tsx scripts/self-play/hold-up-run.ts 0 256 > "$out/boards.jsonl" &&
  node --import tsx scripts/self-play/hold-up-score.ts "$out/boards.jsonl"
```

The development entry point rejects reserved deal and search seeds.
On development deal `347858` the three timed calls used 5,007, 5,002 and 5,002 ms respectively.
Plain and Biased revisited later declarer decision nodes 2,704 and 2,616 times respectively.
These are feasibility checks, not strength evidence.

## Holdout result

All 256 boards completed, with no duplicate deals or overlap with the 64 development boards.
There were 62 eligible decisions: 50 on trick one, five on trick two and seven on trick three.
On the other 194 boards all four policies used the same completed table.
Completing each distinct chosen card once produced 306 actual table outcomes in total.

| Contrast | Different cards | W/L/tied boards | Total IMPs | IMPs/board | Lower bound | Sign p | Net contracts made |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Take − Base | 15 | 1/8/247 | −60 | −0.234 | −0.508 | 0.9980 | −5 |
| Plain − Base | 27 | 6/7/243 | −19 | −0.074 | −0.367 | 0.7095 | −2 |
| Plain − Take | 36 | 13/7/236 | +41 | +0.160 | −0.168 | 0.1316 | +3 |
| Biased − Base | 28 | 6/7/243 | −19 | −0.074 | −0.367 | 0.7095 | −2 |
| Biased − Take | 37 | 13/7/236 | +41 | +0.160 | −0.168 | 0.1316 | +3 |
| Biased − Plain | 10 | 0/0/256 | 0 | 0 | 0 | 1.0000 | 0 |

The incumbent made 226 contracts, Take made 221, and each tree made 224.
Always taking the ace cost five contracts that the incumbent made and rescued none.
Plain rescued two contracts that the incumbent lost and lost four that the incumbent made.
The hold-up bonus applied on 29 of 62 decisions.
Of its ten card differences against Plain, nine changed only the rank of a duck and one changed taking the ace to ducking; none changed the final tricks.
These observations describe the played continuations and do not establish that those ranks are universally equivalent.
A post-hoc replay of the nine duck-rank changes found five pairs in the incumbent's same public rank class (board indices 49, 111, 164, 207, 232).
The other four pairs belonged to different classes (7, 59, 178, 188); their equal table scores are not a reason to prune them.

At the eligible roots Base scored 42,992 layouts; Plain and Biased completed 66,526 and 67,417 simulations.
The corresponding total root wall times were 310.99, 310.56 and 310.47 seconds; the longest calls were 5.149, 5.115 and 5.037 seconds.
Plain and Biased recorded 121,964 and 123,912 later visits to previously visited declarer decision nodes.
More simulations did not establish stronger play here.

**Decision:** no contrast passed the frozen gates.
No live confirmation was triggered, and neither production play nor bidding changed.
The 64-deal pilot favored taking the ace against a forced duck; that was not a test against the five-second incumbent, which already took the ace at 47 of the 62 holdout forks.

The [raw evidence and frozen protocol](hold-up-ucb-records.tar.gz) have archive SHA-256 `4881dd4b5094bc967488f029d485b820e5d339835837948b2289fc454a58a021`.
From the raw rows a separate checker regenerated every scheduled deal fingerprint, checked the pilot exclusion, reconstructed each 3NT score from tricks and vulnerability, and reproduced every sign probability and all six bootstrap bounds.
The checkout scorer also rejects unique but off-schedule seeds and malformed fingerprints; it produced byte-for-byte the same summary as the frozen scorer on these data.
To rescore the archived observations without repeating any timed play:

```sh
evidence=$(mktemp -d)
tar -xzf docs/benchmarks/hold-up-ucb-records.tar.gz -C "$evidence"
node --import tsx scripts/self-play/hold-up-score.ts "$evidence/hold-up-ucb.jsonl"
node --import tsx --input-type=module - "$evidence" < "$evidence/verify-hold-up-ucb.mjs"
```
