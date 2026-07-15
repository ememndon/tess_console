#!/bin/bash
# Compose all 18 showcase sections at 4K, N at a time (the box is 224-thread; one section
# barely loads it, so we parallelise across sections). Reused for the draft (medium) and the
# final (slow) master. §18 is the only section with arch/card/avatar-out overlays.
#
# Usage: compose-all.sh PRESET CRF NJOBS [avatarPNG]
#   e.g. draft:  compose-all.sh medium 18 6
#        final:  compose-all.sh slow   17 6  /workspace/showcase/avatar/longcat-ring-4k.mp4  (later)
set -u
PRESET=${1:-medium}; CRF=${2:-18}; NJOBS=${3:-6}
ROOT=/workspace/showcase
AV=${4:-$ROOT/media/showcase-stage/avatar-ring-4k-still.png}
CAP=$ROOT/media/showcase-capture
STG=$ROOT/media/showcase-stage
OUT=$ROOT/out; LOG=$ROOT/logs
mkdir -p "$OUT" "$LOG"

# section:jobId  (from capture-manifest.json / collect-facts.py — the 18 locked bundles)
PAIRS="\
01:4c24c6c5-f9c3-472e-99dd-7b384655796d 02:4d9e4b4d-b6d8-41c8-9b20-1e01ff11ddee \
03:85271098-75a3-47f7-b056-a6538b6dda51 04:e2cda170-e6d3-4c0b-b064-cc5ce8430ab3 \
05:ddb14af7-5484-4267-af05-8618352bc508 06:a918fffa-92b2-4a85-8537-bfafe0a768a7 \
07:9d6eb78e-258a-45b6-8189-2fc2abe5fa32 08:55c53d9b-cdef-4980-880b-3f88cd760160 \
09:0b048e58-ed26-4bf1-bd3e-21c30d1fc96e 10:8a071df3-6efa-4f70-b122-347342c58224 \
11:72d2b2f8-bd18-44be-8901-1ec3c8d5b599 12:3690818d-8bde-4541-bdab-6cad1cc34ba3 \
13:085999dc-0135-4b64-ac64-55293dc7496a 14:e74f5c62-52b1-41ee-a497-51a5590320de \
15:fcbfdddb-5505-43c6-9fcd-6cf784bde51c 16:dfffbb7c-25d1-4238-be8b-8c5712c41f55 \
17:2427f09b-6653-44a3-b9e4-16a0b0513dae 18:66ed898a-5b1e-44b8-91e4-d4338ec29046"

compose_one() {
  n=$1; jid=$2
  bun=$CAP/$jid/16x9uhd
  extra=()
  if [ "$n" = "18" ]; then
    extra=(--avatar-out 124.47 \
      --arch-video "$STG/section-18/arch-4k.mov" --arch-at 37.82 \
      --card-b "$STG/section-18/card-B-4k.png" --card-b-at 124.47 \
      --card-a "$STG/section-18/card-A-4k.png" --card-a-at 145.48)
  fi
  t0=$(date +%s)
  python3 "$ROOT/compose-runner/run.py" --bundle "$bun" --out "$OUT/s$n-4k.mp4" \
    --height 2160 --enc libx264 --x264-preset "$PRESET" --x264-crf "$CRF" \
    --avatar "$AV" "${extra[@]}" --cap-pngs "$STG/section-$n/captions-4k" \
    > "$LOG/s$n.log" 2>&1
  rc=$?
  echo "s$n rc=$rc $(( $(date +%s) - t0 ))s" | tee -a "$LOG/_summary.log"
}

echo "=== compose-all: preset=$PRESET crf=$CRF njobs=$NJOBS avatar=$AV ===" | tee "$LOG/_summary.log"
running=0
for pair in $PAIRS; do
  n=${pair%%:*}; jid=${pair#*:}
  compose_one "$n" "$jid" &
  running=$((running+1))
  if [ "$running" -ge "$NJOBS" ]; then wait -n; running=$((running-1)); fi
done
wait
echo "=== ALL SECTIONS DONE ===" | tee -a "$LOG/_summary.log"
ls -lh "$OUT"/s??-4k.mp4 | tee -a "$LOG/_summary.log"
# run.py leaves its mkdtemp workdir behind; 18 sections = ~18GB of /tmp. Safe to clear now
# (nothing else composes concurrently outside this batch).
rm -rf /tmp/compose_* 2>/dev/null
echo "workdirs cleared; disk: $(df -h / | tail -1)" | tee -a "$LOG/_summary.log"