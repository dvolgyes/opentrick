#!/usr/bin/env bash
set -euo pipefail
base=b2858bff0de6c3509e527f5aadfed7a34c2c3aa3
if (( $# < 2 || $# > 3 )); then
  printf 'Usage: %s accuracy|games|holdout OUTPUT [SHARDS:1-16]\n' "$0" >&2
  exit 2
fi
mode=$1
case "$mode" in
  accuracy|games|holdout) ;;
  *) printf 'Unknown study mode: %s\n' "$mode" >&2; exit 2 ;;
esac
shards=${3-8}
if [[ ! $shards =~ ^([1-9]|1[0-6])$ ]]; then
  printf 'SHARDS must be an integer from 1 to 16\n' >&2
  exit 2
fi
out=$(realpath -m "${2:?output directory}")
mkdir -p "$out"
archive=$(mktemp -d)
trap 'rm -rf "$archive"' EXIT

git archive "$base" package.json src scripts/self-play | tar -x -C "$archive"
cp scripts/self-play/proposal-{engine,pool,run}.ts "$archive/scripts/self-play/"
ln -s "$PWD/node_modules" "$archive/node_modules"
cd "$archive"
start=$SECONDS
pids=()
for ((i=0; i<shards; i++)); do
  node --import tsx scripts/self-play/proposal-run.ts "$mode" "$i" "$shards" > "$out/$mode-$i.jsonl" 2> "$out/$mode-$i.stderr" &
  pids+=("$!")
done
status=0
for pid in "${pids[@]}"; do
  wait "$pid" || status=1
done
printf '%s\n' "$((SECONDS - start))" > "$out/$mode.wall-seconds"
exit "$status"
