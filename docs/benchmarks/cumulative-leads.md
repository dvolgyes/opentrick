# Cumulative opening-lead campaign

This offline campaign reuses the [opening optimizer](opening-optimizer.md) fixtures, search budgets, paired table scores, and rule order.
It does not change the engine or its deployment.

## Frozen protocol

- Epoch `e` starts at seed `1400000000 + 160*e`.
  The seed block ends before `1490000000`.
- Train on boards 0–63 with four layouts per search.
  Test on boards 64–159 with eight layouts per search.
- Each group of four boards contains competitive 3NT, competitive major, weak-leader major partscore, and stronger-leader major partscore, in that order.
  Use the optimizer's board numbers and table seeds.
- Keep separate cumulative signed IMP totals and changed-card counts for no-trump and suit.
  In each group, compare the incumbent and 15 distinct rank and margin alternatives.
  Maximize total IMPs, then minimize changed cards.
  Break remaining ties by the existing rule order, with the incumbent first.
- Freeze both fitted rules before measuring the first holdout board.
  Add only training results to the next epoch's accumulator.
- Compare the frozen rule with the unmodified incumbent, the fixed standard rule at a 1-IMP margin, and the previous epoch's frozen rule.
  The incumbent is the previous rule in epoch 0.
- Report the training and holdout denominators, holdout wins, losses and ties, net IMPs and mean, one-sided 95% board-bootstrap lower bounds, and one-sided exact sign probabilities.
  Report whether either rule changed from the previous epoch.
- Nominate only if **both fixed controls** have at least 20 non-ties, a bootstrap lower bound above `+0.05` IMP per board, and a sign probability below `0.025/((e+1)*(e+2))`.
  The previous rule is a diagnostic control, including when the new rule is identical.
  A nomination does not change the engine.
- Stop on a failed board.
  Do not replace it or count it as a tie.

## Start and resume

Use a pinned source checkout and its installed dependencies.
Use a new private directory outside the checkout.
On Linux, run these commands from the checkout root in Bash:

```sh
campaign="$HOME/opentrick-cumulative-leads"
mkdir -m 700 "$campaign"
(umask 077; flock -n 9 && exec nice -n 15 node --import tsx scripts/self-play/cumulative-leads.ts init "$campaign" >>"$campaign.jsonl") 9<"$campaign"
```

To resume:

```sh
(umask 077; flock -n 9 && exec nice -n 15 node --import tsx scripts/self-play/cumulative-leads.ts resume "$campaign" >>"$campaign.jsonl") 9<"$campaign"
```

An optional positive integer after the directory limits the number of epochs for that invocation.
The default runs serially until stopped or until the seed block is exhausted.
The entry point requires an exclusive lock on the campaign directory on file descriptor 9.
A second invocation fails instead of sharing a campaign.
Do not edit the checkout or the installed dependencies while the campaign runs.

Keep the JSONL log outside the campaign directory to retain all epoch summaries.
`state.json` contains the next epoch, the training accumulator, and the last completed summary.
The worker commits one complete epoch at a time.
It replays an uncommitted epoch after interruption without adding duplicate training totals.
The worker checks the state checksum and a fingerprint of the source, selected installed dependencies, and Node version.
The executable fingerprint includes the code that selects the deals, fits the rules, scores the tables and decides nominations; it does not include this report.
Do not reinterpret an existing campaign under a revised protocol.
For a protocol change, update the executable criteria and start a new campaign in a new directory.
If the state is missing, corrupt, or from a different version, the worker stops.
Do not use `init` to reset a failed campaign.
Restore the complete state from a backup or keep the failed directory and start a separate campaign.
Before resuming, compare the last complete log line with `state.json`.
If the last committed summary did not reach the log, recover `state.last` from `state.json` before resuming.

## First completed epoch

The first run used source fingerprint `578394429e2f16fa62bbe0b63da7519db2bf4d19d0b9360b12a4698afaf7286f`.
It fitted the holding-specific lead at a margin of 0 in no-trump and 0.75 in suit contracts on 64 training deals.
On 96 independent holdout boards it gained 7 IMPs against the incumbent (9 wins, 10 losses, 77 ties) and lost 17 against the fixed standard rule (3 wins, 7 losses, 86 ties).
The one-sided 95% lower bounds were −0.146 and −0.427 IMP per board respectively.
The epoch played 398 distinct complete tables and made 99,274 DDS calls across training and holdout.
Neither comparison qualified, so no rule was nominated.
