# Already-beaten cards in a partial trick

## Acceptance test

Compare the candidate with `64ebc9c0d7`, changing neither the deal stream nor the search objective.
A card on the table that has already lost to another card cannot win this trick or occur in a later trick.
It therefore need not separate otherwise equivalent ranks held by the acting hand.
The current winning card must still separate ranks: one concrete card might beat it when another cannot.
Cards of unseen hands remain barriers, and every legal concrete card remains available to the caller.

Before acceptance, require both checks below and at least one saved search on the paired games.

1. On 1,200 legal partial tricks, check every pair of cards grouped together against the native solver's individual scores, for two separately drawn legal hidden layouts per position.
   Start at seed 9600000; play a seeded legal prefix of 2 or 3 cards plus 0–11 completed tricks, rotating across all five strains.
   Do not remove forced positions, and report how many positions gained a merge rather than counting all as evidence for the extension.
2. Play 64 fresh full deals from seed 9500000 in two rooms, using two layouts for one partnership and four for the other, then exchange their budgets.
   Give both versions the same per-action random stream and the same public positions.
   Compare **every card** and both duplicate scores, including boards with no savings.
   Count newly recognized multi-card fast paths and actual saved DDS calls, not elapsed time.

Run `node --import tsx scripts/self-play/beaten-rank-control.ts` first with the pinned source and then with the candidate.
Use the same dependencies and the same driver in both directories.
Reject on any unequal native score in a merged class or any different full card trace.
This is a pruning test, not a test of a new signal or of improved IMP strength.

## Results

Of 1,200 sampled positions, 948 had at least two legal cards.
The change merged groups in 83 **positions**, reducing the total from 2,772 groups to 2,685.
Every concrete card in each merged group received the same native trick count on both sampled layouts; no card was removed from the legal list.

There were **zero card-trace or score differences** across all 128 rooms on the 64 paired deals.
The live shortcut recognized 614 multi-card choices instead of 553, avoiding 61 searches.
Search used 13,474 DDS calls instead of 13,658 (184 fewer, or 1.35%).
Calls decreased on 38 boards, stayed the same on 26 and increased on none.
This establishes less search work at those budgets, not a measured reduction in wall-clock time or an increase in playing strength.
The [ordered results](beaten-ranks.jsonl) include both versions' group and work counts and the common concrete traces.
