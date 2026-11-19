# Standard partner-major lead confirmation

The exploratory holdouts identified the fixed `standard` convention with a 1 estimated-IMP margin as a candidate for confirmation.
This study uses neither those boards nor the two-stream consensus boards.
It makes no production change.

## Frozen design

- Stage 1 (**screen**): use consecutive seeds 1510000000–1510000127, with the opening optimizer's fixture rotation and board numbering.
  Use 32 boards each of competitive notrump, competitive major, partscore weak leader, and partscore stronger leader, without replacements or stratification by observed outcome.
- Each board gets one uninterrupted 5000 ms `analyzePlay` opening, with no sample cap.
  Both arms use the same public hints, layout draws, world weights and estimated scores.
  The incumbent takes the engine's selected lead.
  The candidate uses `partnerOpening("standard", ...)` for partner's explicitly shown natural major, and changes the lead only if its estimated utility is within 1 IMP of the incumbent.
  Actual hidden cards do not enter that choice.
- If the leads differ, complete both tables, alternating table order by board index and coupling the arena's seeded per-ply and per-seat random streams.
  Stage 1 uses eight sampled layouts per searched continuation unless the layout is unique.
  Identical leads skip both tables: under a common continuation they tie by identity, with a raw difference and IMP difference of exactly zero.
  No table scores are imputed.
  Changed leads retain both the defender score and the NS score for each played table.
  Convert the candidate-minus-incumbent defender difference to IMPs once per board.
- **Stage 1 gate:** require all 128 valid rows, at least 24 non-tied IMP results, one-sided exact sign-test p < .025, and a one-sided 97.5% stratified board-bootstrap lower bound > +.05 IMP per board.
  Resample 32 boards with replacement within each fixture in each of 10,000 replicates (seed `0x51f15eed`); use the 250th sorted replicate.
  Identity ties enter the mean and bootstrap, but not the sign test.
- Stage 2 (**live**) starts automatically only if Stage 1 passes.
  Use independent consecutive seeds 1520000000–1520000127, the same fixture rotation and one 5000 ms opening search.
  Identical leads still tie by identity without a replay.
  For different leads, use `obviousPlay`, then `analyzePlay` with its default exact limit and the host's default budget: 5000 ms, or 2000 ms for the last three cards per player.
  There is no fixed sample cap or shared timed-search cache; common per-position seeds do not force equal layout counts or elapsed times.
  The timing excludes browser presentation delays.
  Stage 2 uses the same statistical gate on its own 128 boards.
  Neither gate deploys a policy.

## Frozen run and recovery

Version 1 uses the engine at `b2858bff0de6c3509e527f5aadfed7a34c2c3aa3`.
Export `src`, `scripts/self-play`, `package.json`, and `tsconfig.json` from that commit to a private `source` directory.
Use `scripts/self-play/arena.ts` from `cddf8cefc1e7384737d6fd4624a1259eac80e4f0` for the `playTable` export.
Copy in the two runner files and write the baseline commit to `source/REVISION`.
Copy the installed `bridge-dds`, `tsx`, `esbuild`, `@esbuild`, and `@bridge-tools` packages into `source/node_modules`; do not symlink them or borrow dependencies from the live checkout.
Make the snapshot read-only and use a separate mode-0700 `checkpoint` directory.
The protocol binds the source files, loader, DDS binary, Node version, platform and architecture.
A fingerprint mismatch prevents resume.

The executing snapshot is version 1, fingerprint `ec0a55f77ca883a29f147f5b1ffacc20dfa6a265654bacf8e021db43e49b359d`, on Node v22.22.1.
It predates checkout-only formatting, CLI type narrowing and explicit bootstrap-index guards.
Inspect or resume that cohort with its exact snapshot; do not copy the checkout files over it.
On the first durable row (1510000000), the opening used 268 layouts in 5004.95 ms and the defender scores were −490 (incumbent) and −430 (standard), or +2 IMPs.
This verifies the paired scoring path, not the effectiveness of the rule.
The worker was detached with `setsid`, nice +10 on CPU 14:

```sh
base="$HOME/.local/state/opentrick/standard-confirm-1510000000-v1"
cd "$base/source"
umask 077
setsid -f bash -c '
  echo $$ > "$1/pid"
  exec env -u NODE_OPTIONS -u NODE_PATH taskset -c 14 nice -n 10 node --import tsx scripts/self-play/standard-confirm.ts "$1/checkpoint"
' standard-confirm "$base" </dev/null >>"$base/events.jsonl" 2>>"$base/errors.log"
```

Send `SIGTERM` to the worker PID after verifying it still names that worker.
An orderly stop finishes the current board; a hard interruption can leave a temporary file but no partial evidence.
An OS directory lock excludes another writer.
Completed rows are synced and published atomically before their `board` event, with checksum, source identity, fixture, seed and deal identity.
Resume validates the contiguous prefix, never replaces a completed row, and treats a durable `invalid.json` from a board error as terminal.
Append `--doctor` to the direct Node command for read-only validation and summaries, or inspect `events.jsonl`.
During an active run the doctor sees only a published prefix.
Do not delete data to resume.

Summaries report elapsed count, sum and range for boards, roots, tables and timed decisions; actual root and timed sample counts; fixed DDS calls; and lead changes, identity ties and positive, negative and zero IMP results by fixture.
An incomplete stage reports no gate result.

## Screen result

All 128 scheduled deals completed with distinct hand distributions.
The candidate changed 73 opening leads; those deals produced 146 complete tables.
The other 55 deals tied by identity and have no invented table scores.

| Fixture (32 boards each) | Changed leads | Wins | Losses | Ties | Net IMPs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Competitive notrump | 13 | 3 | 0 | 29 | +5 |
| Competitive major | 21 | 6 | 2 | 24 | +15 |
| Partscore, weaker leader | 17 | 1 | 4 | 27 | −9 |
| Partscore, stronger leader | 22 | 6 | 2 | 24 | +5 |
| **All deals** | **73** | **16** | **8** | **104** | **+16** |

The matched defender-score difference was +340 raw points overall.
After per-board IMP conversion the mean was +0.125 IMP per board, with a one-sided stratified 97.5% lower bound of −0.219.
The 24 non-ties met the minimum count, but the one-sided sign probability of 0.0758 exceeded 0.025 and the lower bound did not exceed +0.05.
Stage 1 failed, so Stage 2 did not start and the playing default did not change.
This result does not establish that conventional leads are harmful or that they are equivalent to search.

The [frozen protocol, 128 complete board records and worker events](standard-confirm-records.tar.gz) have SHA-256 `c7b58c3430372508796e56fc5e3f891b7ff33a79e3b98a98f2be2e44cd0edff8`.
Independent reconstruction from the two raw scores on each changed lead reproduced every board difference and the worker's summary.

### Exploratory contract-defeat safeguard

After the screen, we tested one stricter rule against its recorded counterfactual tables.
Keep the conventional switch only when its root estimate of the probability of defeating the contract is at least the incumbent's estimate.
The new rule retained 32 switches and vetoed 41; 20 vetoes changed the duplicate result.
Across the same 128 boards it gained 12 IMPs against search (3 wins, 1 loss, 124 ties), but lost 4 against the original conventional rule (7 wins, 13 losses, 108 ties).
Both contrasts use paired raw defender scores before IMP conversion.
The safeguard did not beat both controls even on these exploratory data, so it did not advance to a fresh trial.
