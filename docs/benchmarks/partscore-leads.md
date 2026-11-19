# Partscore opening-lead experiment

## Protocol (frozen before scoring)

This is an exploratory comparison of guarded partner-suit opening leads against incumbent DDS in constructed competitive major-suit partscores, not a policy promotion test.
Use exactly 128 deals, index `i = 0…127`, seed `9400000+i`, board `i+1`, with 8 layouts at each nonforced action (or the incumbent's unique-layout exception).
For each seed, take the first qualifying complete shuffle from the arena SplitMix32 stream, at most 500,000 draws, and preflight all 128 boards for valid deals, auction, and public opening hint before any search.
On odd-numbered boards the leader has 0–3 HCP; on even-numbered boards the leader has 4–7 HCP.
The dealer opens a longest 5+ major with 12–16 HCP, preferring spades on a major tie.
LHO overcalls the other major with 9–14 HCP and 5+ cards meeting the existing `SHAPES.goodSuit` honor rule.
Opener's partner passes with no more than 7 HCP, with fewer than three cards in opener's major when holding 6–7 HCP.
Advancer raises with 3+ trumps and 6–9 HCP over `1S` or 7–9 over `2H`.
The auctions are `1H-(1S)-P-(2S)-P-P-P` and `1S-(2H)-P-(3H)-P-P-P`; both contracts are partscores.
Full original hands enforce the fixture rules only, and both policies get the same natural 5+ major opening meaning from `playPosition` with only the opening call's HCP-system origin known.

Each deal runs `playPair` against incumbent for `high`, `standard`, and `suit-only` at the same search seed (the deal seed) with the arena's per-action common random numbers and shared per-board search cache.
Only the opening lead can change; void, missing, or conflicting public suit evidence abstains, and the incumbent stays if the proposed card loses more than 1 estimated IMP.
`high` and `standard` use the existing partner-suit carding rules; `suit-only` uses the first DDS-ranked card in the very same publicly inferred nontrump suit.
Record the incumbent card, proposed cards, outcomes of the guard, realized leads, paired raw scores, policy decision/layout counts, and unique searches and DDS calls.
Before scoring, classify leader holdings in partner's suit by length and ranks; report doubletons, honor (A/K/Q/J) with at least three cards, and informative K/Q/J with at least two small cards and no other A/K/Q/J/T (small is 9 or lower).
Report how often advice is available, high and standard disagree, and contrasts actually change lead rank within the same suit; with fewer than ten informative holdings draw no broad rank inference.

Each contrast uses all 128 boards, including ties and failures (log failed arm and count a comparison involving it as zero).
Candidate improvement is `scoreNS(candidateNS) - scoreNS(candidateEW)` in raw duplicate points, regardless of which side defends.
The direct rank-policy comparisons are standard minus high, suit-only minus high, and suit-only minus standard, subtracting signed raw duplicate deltas per board before conversion to IMPs.
These are intention-to-treat contrasts between rules targeting the same suit; the guard can cause actual leads to differ in suit.
Report wins, losses, ties, net IMPs and the existing 10,000-resample one-sided 95% bootstrap lower bound in IMPs per board, for the full sample and both fixed strata.
Report opening lead changes and vetoes for each arm, and within-suit rank changes for direct contrasts.
Nominate suit-only for independently frozen confirmation only if its lower bound is positive against the incumbent and both alternatives, and it has at least 20 non-ties against incumbent; never promote from this run.

## Results

The single scoring run used Linux x64, Node v22.22.1 and `bridge-dds` 1.4.0; the command was `node --import tsx scripts/self-play/partscore-leads.ts > docs/benchmarks/partscore-leads.jsonl`.
The process loaded the incumbent `64ebc9c0d7` rank-class logic at startup, before the separate current-trick pruning candidate was applied in the worktree; no engine version changed within the running process.
The complete preflight succeeded without replacing seeds, with a maximum of 133,545 shuffle draws, and all 384 paired plays succeeded.
The three scoped regression tests passed, as did Biome on the two new TypeScript files and the project typecheck.
JSONL arm order is high, standard, suit-only; room score order is candidate as North–South, then candidate as East–West.
The [128 raw rows](partscore-leads.jsonl) have SHA-256 `9e6516f3f0c0f410ca8bc9f9ddb7c3257ca77aaf3c4261760f409f1ea7b242df`.

| Leader HCP | Candidate vs control | Wins/losses/ties | Net IMPs | Lower 95% (IMP/board) | Within-suit lead changes |
| --- | --- | ---: | ---: | ---: | ---: |
| All | High vs incumbent | 22/17/89 | +14 | −0.1016 | 30 |
| All | Standard vs incumbent | 21/13/94 | +23 | −0.0078 | 17 |
| All | Suit-only vs incumbent | 21/14/93 | +21 | −0.0234 | 0 |
| All | Standard vs high | 6/3/119 | +9 | −0.0469 | 57 |
| All | Suit-only vs high | 6/4/118 | +7 | −0.0625 | 95 |
| All | Suit-only vs standard | 1/2/125 | −2 | −0.0469 | 47 |
| 0–3 | High vs incumbent | 12/9/43 | +9 | −0.1719 | 18 |
| 0–3 | Standard vs incumbent | 11/7/46 | +15 | −0.0156 | 8 |
| 0–3 | Suit-only vs incumbent | 11/7/46 | +15 | −0.0156 | 0 |
| 0–3 | Standard vs high | 4/3/57 | +6 | −0.1406 | 43 |
| 0–3 | Suit-only vs high | 4/3/57 | +6 | −0.1406 | 56 |
| 0–3 | Suit-only vs standard | 0/0/64 | 0 | 0.0000 | 20 |
| 4–7 | High vs incumbent | 10/8/46 | +5 | −0.1875 | 12 |
| 4–7 | Standard vs incumbent | 10/6/48 | +8 | −0.1406 | 9 |
| 4–7 | Suit-only vs incumbent | 10/7/47 | +6 | −0.1719 | 0 |
| 4–7 | Standard vs high | 2/0/62 | +3 | 0.0000 | 14 |
| 4–7 | Suit-only vs high | 2/1/61 | +1 | −0.0625 | 39 |
| 4–7 | Suit-only vs standard | 1/2/61 | −2 | −0.0938 | 27 |

| Leader HCP | Doubletons | Honor + length | Informative | Advice available | High and standard propose different ranks | Informative actual same-suit differences |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| All | 37 | 30 | 20 | 127 | 67 | 17 |
| 0–3 | 10 | 22 | 17 | 64 | 49 | 15 |
| 4–7 | 27 | 8 | 3 | 63 | 18 | 2 |

High and standard proposed different ranks on all 20 informative holdings, but only 17 of those produced different leads in the same suit after the guard.
The 67 `2S` and 61 `3H` contracts split 34/30 in the 0–3 HCP stratum and 33/31 in the 4–7 HCP stratum.

| Leader HCP | Arm | Opening lead changes | Vetoes | Decisions | Layouts |
| --- | --- | ---: | ---: | ---: | ---: |
| All | High | 103 | 14 | 10,564 | 79,794 |
| All | Standard | 91 | 12 | 10,566 | 79,880 |
| All | Suit-only | 74 | 12 | 10,567 | 79,825 |
| 0–3 | High | 57 | 7 | 5,289 | 40,282 |
| 0–3 | Standard | 48 | 5 | 5,295 | 40,400 |
| 0–3 | Suit-only | 40 | 5 | 5,296 | 40,422 |
| 4–7 | High | 46 | 7 | 5,275 | 39,512 |
| 4–7 | Standard | 43 | 7 | 5,271 | 39,480 |
| 4–7 | Suit-only | 34 | 7 | 5,271 | 39,403 |

Decisions and layouts count both rooms including cache hits; the shared search cache performed 12,437 unique searches and 94,113 DDS calls (0–3 HCP: 6,812 and 51,801; 4–7 HCP: 5,625 and 42,312).

**Decision: no nomination or promotion.**
An arm failure would also preclude nomination; no arm failed.
Suit-only had 35 non-ties against incumbent, but all three of its overall lower bounds were negative and its direct net result against standard was −2 IMPs.
The overall sample cleared the ten-holding threshold, but few rank contrasts changed the score and none had a positive lower bound.
The 4–7 HCP stratum had only three informative holdings, so it provides no broad rank inference.
The strata are descriptions of the prescribed fixtures, not a causal estimate of leader HCP, and these results do not generalize to other auctions or layout budgets.
The lead conventions motivating the variants are described by [Larry Cohen](https://www.larryco.com/bridge-articles/opening-leads) and [David Lindop](https://acblunit390.org/web_documents/Grant/38%20Leading%20Against%20Suit%20Contracts.pdf).
