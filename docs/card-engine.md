# Local card engine

Host-managed bots and the Node bot use the selected OpenRouter models for bidding.
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
Known bidding-system meanings add soft likelihood weights for points and shape.
They never exclude every layout when a player has misbid.

`DdsSolver` wraps [bridge-dds 1.4.0](https://github.com/bookchris/bridge-dds-js), an Apache-2.0 WebAssembly build of DDS.
The package is pinned with its registry integrity hash and has no runtime dependencies.
Its license and attribution are distributed with the static site under `public/licenses/`.
The adapter validates card identities, uniqueness, hand sizes, partial tricks, trump, and leader before constructing the bounded PBN representation.
It expands DDS equivalent-card masks and reports future tricks for the partnership on turn.

`analyzePlay` evaluates all legal candidates in the same sampled worlds.
It uses duplicate scoring, including vulnerability and doubling, and maximizes expected IMP difference from the contract just made.
This gives making or defeating a contract the correct scale relative to overtricks.
It reports candidate scores, contract success probabilities, sample count, effective sample size, and elapsed time.
A forced play needs no search.

`BrowserPlayEngine` owns one worker and its search lifecycle.
It accepts only a card in the current authoritative legal list.
The host checks the position again before sending the action through the existing game controls.
Stopping or pausing aborts the request.
An abort terminates synchronous native work; resuming can create a fresh worker.
Claims, undo requests, seat changes, and stale results still pass through the existing host checks.

The default core budget is 96 samples or 1,200 ms, checked between native calls.
Completed evaluations are sent progressively.
At 1,500 ms, the browser returns the latest completed evaluation and terminates a native call that has overrun the budget.
If no evaluation has completed yet, it waits for the first result, with a hard deadline of 15 seconds.
A hard deadline without a result is an explicit error; it does not substitute a random card or call an LLM.
The Node bot uses the same core with its soft budget; a single synchronous native call can exceed that budget.

## Verification

The unit checks cover hidden-information invariance, unseen-card conservation, exposed dummy, shown voids, legal full-board play, equivalent cards, partial tricks, trump overruffs, invalid native input, contract safety, cancellation, and worker deadlines.
DDS results are also compared with independent exhaustive minimax on two-trick endings in every strain and each partial-trick length.
The browser tests play a complete board in a real Chrome worker while a page timer continues, then abort and restart the worker.
The production-build end-to-end test plays two consecutive boards, checks 104 local card decisions, and asserts that no card-play request reaches OpenRouter.

A visible Chrome window at `http://localhost:5177` also completed a full board with live OpenRouter bidding.
After that check, West was returned to human control and the other three bots remained active.
Run the demo again with an `OPENROUTER_API_KEY` in `.env`:

```sh
npm run demo:bot
```

The demo stores the key in its host browser profile, as the game normally does.
It does not print or export the key or the room invitation.
Close the demo browser to stop its server.

## Reproducible evaluation

```sh
npm run benchmark:play
npm run benchmark:play -- --llm
BENCHMARK_MODEL=inception/mercury-3 npm run benchmark:play -- --llm --mixed
```

The `--llm` runs make real, billed API calls using `.env`.
Without that flag, the command measures only the local engine.
Fixed seeds and positions are declared in the script before each suite runs.
All sampled positions are reported, including forced plays and unusable model replies.
Models get only their permitted view and the existing game prompts.
Actual hidden hands are used only by the separate evaluation oracle.
Neither engine nor model receives them for its decision.

The metric is tricks lost relative to perfect-information optimal play at the same position.
It is a diagnostic, not a tournament rating: a valid single-dummy choice can lose against an oracle that knows the hidden cards.
The recorded positions follow random legal play and fixed contracts, rather than expert auctions and play.
Comparisons use the same successful model-response positions; request failures are reported separately.

Observed on Node 22.22.1, Linux x64, AMD Ryzen 7 4800H:

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

## Security and recovery

The assets in this change are the host's API key, hidden cards, game authority, and browser responsiveness.
The new crossing is from a permitted position to a local worker and then to a native solver.
Boundary checks use card enums, bounded card counts, and a bounded PBN string; there is no dynamic code or HTML sink.
The resulting card is checked against the legal list before the existing host authorizes an action.
API keys stay outside the worker, benchmark output, room links, and source bundle.

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
