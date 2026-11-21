# Local card engine

Host-managed bots and the Node bot use the [local bidding engine](bidding-engine.md).
They use a local single-dummy card engine for play.
The browser runs this engine in a Web Worker.
There is no new server and no change to the room protocol or stored boards.

## Architecture and information boundary

`playPosition` converts the board to the acting player's permitted information before search starts.
Declarer controls dummy with declarer's hand and the exposed dummy hand.
Dummy stays hidden before the opening lead.
The search receives no full deal, API key, or hidden original hand.

`createHandSampler` constructs possible remaining hands from unaccounted cards, hand sizes, and shown voids.
Before the opening lead it shuffles the three unknown hands uniformly.
Once dummy is exposed, it assigns cards forced by voids and uniformly divides the other cards between the two hidden hands.
This needs no rejection loop, including in constrained endings.
When there are at most 256 legal two-hand allocations, timed search visits them in shuffled order and stops when it exhausts the population.
If the clock interrupts a traversal, the completed layouts form a random prefix rather than a fixed subset.
Known bidding-system meanings add soft likelihood weights for points and shape.
Each meaning uses the system recorded when its call was made; calls by bots and calls of unknown origin add no guide assumptions.
They never exclude every layout when a player has misbid.
When multiple calls describe the same hidden hand, search prepares the public play history once and evaluates each required point scale and suit shape once per layout.
For [corrected high-card points](benchmarks/points-control.md), search computes the same corrections as the bidding guide without sorting cards or constructing explanation text.

`DdsSolver` wraps [bridge-dds 1.4.0](https://github.com/bookchris/bridge-dds-js), an Apache-2.0 WebAssembly build of DDS.
The package is pinned with its registry integrity hash and has no runtime dependencies.
Its license and attribution are distributed with the static site under `public/licenses/`.
The adapter validates card identities, uniqueness, hand sizes, partial tricks, trump, and leader before constructing the bounded PBN representation.
It expands DDS equivalent-card masks and reports future tricks for the partnership on turn.
The [sparse result decoder](benchmarks/adapter-exact.md) visits only ranks that DDS reports and preserves their original order.
The adapter builds the PBN holdings directly from suit masks instead of sorting each hand four times per layout.

With two tricks left and two legal cards, the local bot uses [exact endgame search](benchmarks/two-trick-exact.md) on each sampled layout.
It searches the penultimate trick and scores the forced last trick directly; it does not assume that the two legal cards are equivalent.

`analyzePlay` evaluates all legal candidates in the same sampled worlds.
It uses duplicate scoring, including vulnerability and doubling, and maximizes expected IMP difference from the contract just made.
This gives making or defeating a contract the correct scale relative to overtricks.
It reports candidate scores, contract success probabilities, sample count, effective sample size, and elapsed time.
A forced play needs no search.
When hand sizes and shown voids leave exactly one layout, scoring that layout once gives the exact evaluation.
The host and Node bot also skip search when all legal cards are equivalent ranks in one suit.
The engine can group two ranks when every rank between them is in the acting hand, a completed trick, or [already beaten on the table](benchmarks/beaten-ranks.md).
The current winning card still separates ranks: with H6 winning, H7 can take the lead and H5 cannot.
The bot chooses the lowest equivalent rank, just as the full search does.
In mixed choices the engine accumulates one result per publicly equivalent rank class, and computes the score and IMP value once per distinct trick count.
It still reports a separate evaluation for every legal card: a five and a six can carry different information to partner even when their trick values agree.
This does not remove a branch from native DDS, which already recognizes equivalent cards.

`BrowserPlayEngine` owns one worker and its search lifecycle.
It accepts only a card in the current authoritative legal list.
The host checks the position again before sending the action through the existing game controls.
Stopping or pausing aborts the request.
An abort terminates synchronous native work; resuming can create a fresh worker.
Claims, undo requests, seat changes, and stale results still pass through the existing host checks.
When a human partner controls a bot declarer's hands, that player can also request undo and claim on the declarer's behalf.
The opposing players still decide those requests.
When a defender requests a card undo, only the controller of the declaring side decides.
This is the declarer, or the human dummy when they control the bot declarer.
If a build upgrade restores an older two-voter card undo, the controller must confirm the pending request again.
Undo can continue from card play into the auction, with both opponents deciding an undo of a bid.

The default budget is 5,000 ms per non-forced card decision, checked between native calls.
Above the exact cutoff, there is no default sample-count cap; faster positions spend the remaining time on more hidden-hand samples.
Fixed sample budgets use sampling with replacement for reproducible comparisons unless the caller sets `exactLimit`.
The host preference `opentrick.settings.play-time-ms` stores whole seconds as milliseconds, from 1,000 to 60,000, and defaults to 5,000 when absent or invalid.
The Settings control selects whole seconds, and an older fractional preference is rounded to the nearest allowed second when read.
`BrowserPlayEngine` also accepts a constructor budget and a per-request override.
Completed evaluations are sent progressively.
At the configured target, the browser returns the latest completed evaluation and terminates an overrunning native call.
If no evaluation has completed yet, it waits for the first result, with a hard deadline of the larger of 15 seconds and the configured target plus 10 seconds.
A hard deadline without a result is an explicit error; it does not substitute a random card or call an LLM.
The Node bot uses the same core with its soft budget; a single synchronous native call can exceed that budget.
Forced plays return immediately.
The additional samples improve Monte Carlo resolution; DDS itself already solves each sampled deal exactly.
The change does not remove imperfect-information strategy limits or establish a measured strength improvement.

## Verification

The unit checks cover hidden-information invariance, unseen-card conservation, exposed dummy, shown voids, legal full-board play, equivalent cards, partial tricks, trump overruffs, invalid native input, contract safety, cancellation, and worker deadlines.
DDS results are also compared with independent exhaustive minimax on two-trick endings in every strain and each partial-trick length.
The browser tests play a complete board in a real Chrome worker while a page timer continues, then abort and restart the worker.
They separately test the real five-second default on an ending with more than 96 samples.
Routine full-board UI tests use the supported 150 ms preference to keep them bounded; these test integration and legality, rather than playing strength.
The production-build end-to-end test plays two consecutive boards, checks 104 local card decisions, and asserts that no card-play request reaches OpenRouter.

Run the fully local visible demo at `http://localhost:5178`:

```sh
npm run demo:bot
```

It verifies one full board, returns West to human control, and leaves three bots active.
Close the browser to stop the demo server.

## Reproducible evaluation

To play a generated deal twice with the partnerships swapped:

```sh
npm run --silent benchmark:selfplay -- --candidate cash --seed 42 --samples 6
```

To replay a specific hand, pass its unfinished OpenTrick board as `--board "$(cat board.json)"` instead of `--seed`.
The JSON Lines output includes the starting board, both legal play traces, both scores and the IMP difference.
The [self-play protocol and results](benchmarks/card-self-play.md) distinguish benchmark-only policies from changes accepted for live play.
The [search comparisons](benchmarks/search-improvements.md) give the historical engine control, the exhaustive reference and the ongoing opening-lead experiment.
The [defensive advice trials](benchmarks/defensive-priors.md) compare second-hand low, leads in partner's bid suit, fourth-best side-suit leads and singletons against the same search without advice.
The [3NT hold-up study](benchmarks/hold-up-ucb.md) compares plain and heuristic-biased information-set UCB with the incumbent and an always-take-the-ace control on fresh complete deals.
The [whole-board UCB study](benchmarks/mixed-ucb.md) tests both partnerships from the opening lead through the last trick in all five strains, with the auction held fixed.
The [opening-lead optimizer](benchmarks/opening-optimizer.md) fits separate suit and no-trump rules from complete training games, then tests them against two controls on new deals.
The [cumulative campaign](benchmarks/cumulative-leads.md) carries training results across batches, keeps test deals out of training, and never deploys a rule automatically.
The [two-hand sampling](benchmarks/variance-results.md) and [auction-guided opening sampling](benchmarks/proposal-opening-results.md) trials report estimation error separately from paired game scores.
The [expanded endgame search](benchmarks/expanded-frontier.md) and its [narrower follow-up](benchmarks/guarded-frontier.md) explain why the live cutoff remains 256 layouts.

```sh
npm run benchmark:play
npm run benchmark:play -- --mixed
```

The commands evaluate the local engine against DDS on fixed seeded positions.
They need no credentials or external inference service.
All positions are reported, including forced plays.
Actual hidden hands are used only by the separate evaluation oracle.
The playing engine receives only its permitted position.

The metric is tricks lost relative to perfect-information optimal play at the same position.
It is a diagnostic, not a tournament rating: a valid single-dummy choice can lose against an oracle that knows the hidden cards.
The recorded positions follow random legal play and fixed contracts, rather than expert auctions and play.
Comparisons use the same successful model-response positions; request failures are reported separately.

The following earlier measurements are archived baselines from before remote inference was removed.
Their raw records remain available, but current tools run the local engine only.
They were observed on Node 22.22.1, Linux x64, AMD Ryzen 7 4800H:

| Suite | Local engine | LLM |
| --- | --- | --- |
| 24 no-trump positions, GPT-6 Luna | 24 legal decisions; 22 oracle-optimal | 10 usable decisions; 14 failures |
| 32 mixed-contract positions, Mercury 3 | 32 legal decisions; 28 oracle-optimal | 28 usable decisions; 4 failures |
| 28 paired mixed positions | 6 total tricks lost to the oracle | 12 total tricks lost to the oracle |

The mixed suite includes opening leads and all five strains.
The local core averaged 919 ms per mixed position; Mercury averaged 2,696 ms per attempt.
These are observed offline core timings, not a browser latency guarantee.
One core search took 10,607 ms because of a slow native call.
That observation led to the progressive browser response control described above.
The core evaluation policy and scoring were not tuned on these positions.

The raw [no-trump run](benchmarks/llm-no-trump.jsonl) and [mixed run](benchmarks/llm-mixed.jsonl) preserve each attempt and timing.
An [initial probe](benchmarks/llm-initial-probe.jsonl) stopped after three completed positions when the fourth model request returned reasoning without a card.
The later no-trump run records all 24 attempts instead of stopping on an upstream failure.
The new mixed suite was fixed before running and used fresh deals.
The runs do not establish strength against expert humans or established commercial bridge programs.

A separate [3NT test with 25–27 HCP](benchmarks/3nt-25-27.md) played 12 complete boards through the production browser worker.
Those recorded results used the earlier 96-sample budget and were not rerun for the five-second default.
It records make rates by point total, double-dummy makeability, and every card played.
Run it with `npm run --silent benchmark:3nt`; it requires no API key.

## Security and recovery

The protected assets are hidden cards, game authority, and browser responsiveness.
The new crossing is from a permitted position to a local worker and then to a native solver.
Boundary checks use card enums, bounded card counts, and a bounded PBN string; there is no dynamic code or HTML sink.
The resulting card is checked against the legal list before the existing host authorizes an action.
The local bot path has no credential input or remote inference client.

Spoofing and elevation of privilege use the unchanged host authorization controls.
Tampering is checked by legal-card and stale-position validation.
Information disclosure is checked by hidden-hand invariance and key-free worker input.
Denial of service is bounded by one worker, search budgets, and worker termination.
Repudiation introduces no new remote action or audit authority; actions still use the existing room log.
Dependency identity, registry integrity, provenance metadata, license, and the npm vulnerability audit were checked before integration.
No cryptographic scheme, secret lifecycle, or network privilege was added.
This is a focused input-validation and isolation review, not an ASVS certification of the existing application.

The user remains the owner of residual solver and imperfect-information playing risks.
An engine error stops the affected bots visibly so that the host can resume or take manual control.
Reverting the bot-engine commit restores the earlier play strategy without a data migration.

## Strength limits

This is perfect-information Monte Carlo, not an information-set optimal strategy.
It can overvalue lines that require future knowledge of hidden cards, and it does not model deceptive play, partnership carding agreements, or every auction convention.
A small sample or a low effective sample size can give an unstable decision.
The recorded improvement against one LLM fallback is evidence for those tested positions only.
Larger paired duplicate matches against strong opponents remain the next strength test.
