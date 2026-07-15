#!/bin/bash
# As each LongCat head lands, mask into the ring + compose the section at 4K FINAL quality
# (libx264 slow/crf17) with the real talking head. Polls heads/; idempotent (skips composed).
# Runs on the CPU alongside the GPU head-gen. §18 gets arch/cards/avatar-out.
set -u
CR=/workspace/showcase/compose-runner
HEADS=/workspace/longcat/heads
STG=/workspace/showcase/media/showcase-stage
CAP=/workspace/showcase/media/showcase-capture
OUT=/workspace/showcase/final; LOG=/workspace/showcase/logs/final
mkdir -p "$OUT" "$LOG"
PRESET=slow; CRF=17
declare -A JID=(
 [01]=4c24c6c5-f9c3-472e-99dd-7b384655796d [02]=4d9e4b4d-b6d8-41c8-9b20-1e01ff11ddee
 [03]=85271098-75a3-47f7-b056-a6538b6dda51 [04]=e2cda170-e6d3-4c0b-b064-cc5ce8430ab3
 [05]=ddb14af7-5484-4267-af05-8618352bc508 [06]=a918fffa-92b2-4a85-8537-bfafe0a768a7
 [07]=9d6eb78e-258a-45b6-8189-2fc2abe5fa32 [08]=55c53d9b-cdef-4980-880b-3f88cd760160
 [09]=0b048e58-ed26-4bf1-bd3e-21c30d1fc96e [10]=8a071df3-6efa-4f70-b122-347342c58224
 [11]=72d2b2f8-bd18-44be-8901-1ec3c8d5b599 [12]=3690818d-8bde-4541-bdab-6cad1cc34ba3
 [13]=085999dc-0135-4b64-ac64-55293dc7496a [14]=e74f5c62-52b1-41ee-a497-51a5590320de
 [15]=fcbfdddb-5505-43c6-9fcd-6cf784bde51c [16]=dfffbb7c-25d1-4238-be8b-8c5712c41f55
 [17]=2427f09b-6653-44a3-b9e4-16a0b0513dae [18]=66ed898a-5b1e-44b8-91e4-d4338ec29046 )
ORDER="15 09 12 13 01 08 14 02 18 07 10 17 11 03 05 16 06 04"

compose_one(){
  local n=$1 jid=${JID[$1]} head=$HEADS/s$1.mp4 out=$OUT/s$1-4k.mp4 ring=$STG/s$1-avatar-ring.mov
  [ -f "$out" ] && return 0
  [ -f "$head" ] || return 1
  bash "$CR/avatar-ring.sh" "$head" "$ring" >"$LOG/ring-$1.log" 2>&1 || { echo "s$1 RING FAIL" | tee -a "$LOG/_summary.log"; return 1; }
  local extra=()
  [ "$n" = "18" ] && extra=(--avatar-out 124.47 \
    --arch-video "$STG/section-18/arch-4k.mov" --arch-at 37.82 \
    --card-b "$STG/section-18/card-B-4k.png" --card-b-at 124.47 \
    --card-a "$STG/section-18/card-A-4k.png" --card-a-at 145.48)
  local t0; t0=$(date +%s)
  python3 "$CR/run.py" --bundle "$CAP/$jid/16x9uhd" --out "$out" --height 2160 --enc libx264 \
    --x264-preset $PRESET --x264-crf $CRF --avatar-video "$ring" "${extra[@]}" \
    --cap-pngs "$STG/section-$n/captions-4k" >"$LOG/s$1.log" 2>&1
  local rc=$?
  echo "s$1 composed rc=$rc $(( $(date +%s)-t0 ))s -> $(ls -la "$out" 2>/dev/null | awk '{print $5}')B $(date +%H:%M:%S)" | tee -a "$LOG/_summary.log"
}

echo "=== compose-heads start $(date) ===" | tee -a "$LOG/_summary.log"
while true; do
  d=0
  for n in $ORDER; do
    [ -f "$OUT/s$n-4k.mp4" ] && { d=$((d+1)); continue; }
    compose_one "$n" && d=$((d+1))
  done
  [ "$d" -ge 18 ] && break
  sleep 45
done
echo "=== ALL 18 COMPOSED $(date) ===" | tee -a "$LOG/_summary.log"