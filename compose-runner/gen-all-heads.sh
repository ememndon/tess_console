#!/bin/bash
# Generate all 18 section talking heads with LongCat (distilled INT8 480p, ai2v), sequential,
# shortest-first, idempotent (skips a section whose output already exists so it's resumable).
# Output: /workspace/longcat/heads/sNN.mp4 (25fps, audio muxed). Drives lips off each
# section's bodyVo.wav. Energy is baked (distill forces guidance off) — the circle crop tames it.
set -u
ROOT=/workspace/longcat
VP=$ROOT/venv/bin/python
CAP=/workspace/showcase/media/showcase-capture
HEADS=$ROOT/heads; LOGS=$ROOT/logs/heads; mkdir -p "$HEADS" "$LOGS"
export CUDA_VISIBLE_DEVICES=0 RANK=0 WORLD_SIZE=1 LOCAL_RANK=0 MASTER_ADDR=127.0.0.1 MASTER_PORT=29520 PYTHONUNBUFFERED=1
cd "$ROOT/LongCat-Video"
PROMPT="A professional man sits at his desk in a home-office studio, speaking to the camera."

# section:jobId — ordered SHORTEST audio first
PAIRS="\
15:fcbfdddb-5505-43c6-9fcd-6cf784bde51c 09:0b048e58-ed26-4bf1-bd3e-21c30d1fc96e \
12:3690818d-8bde-4541-bdab-6cad1cc34ba3 13:085999dc-0135-4b64-ac64-55293dc7496a \
01:4c24c6c5-f9c3-472e-99dd-7b384655796d 08:55c53d9b-cdef-4980-880b-3f88cd760160 \
14:e74f5c62-52b1-41ee-a497-51a5590320de 02:4d9e4b4d-b6d8-41c8-9b20-1e01ff11ddee \
18:66ed898a-5b1e-44b8-91e4-d4338ec29046 07:9d6eb78e-258a-45b6-8189-2fc2abe5fa32 \
10:8a071df3-6efa-4f70-b122-347342c58224 17:2427f09b-6653-44a3-b9e4-16a0b0513dae \
11:72d2b2f8-bd18-44be-8901-1ec3c8d5b599 03:85271098-75a3-47f7-b056-a6538b6dda51 \
05:ddb14af7-5484-4267-af05-8618352bc508 16:dfffbb7c-25d1-4238-be8b-8c5712c41f55 \
06:a918fffa-92b2-4a85-8537-bfafe0a768a7 04:e2cda170-e6d3-4c0b-b064-cc5ce8430ab3"

echo "=== gen-all-heads start $(date) ===" | tee -a "$LOGS/_summary.log"
for pair in $PAIRS; do
  n=${pair%%:*}; jid=${pair#*:}
  out=$HEADS/s$n.mp4
  if [ -f "$out" ]; then echo "s$n exists — skip" | tee -a "$LOGS/_summary.log"; continue; fi
  wav=$CAP/$jid/16x9uhd/bodyVo.wav
  D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$wav")
  nseg=$(python3 -c "import math;d=$D;print(max(1, math.ceil((d-3.72)/3.2)+1) if d>3.72 else 1)")
  json=$HEADS/s$n.json
  printf '{"prompt": "%s", "cond_image": "%s/avatar_new.png", "cond_audio": {"person1": "%s"}}\n' "$PROMPT" "$ROOT" "$wav" > "$json"
  echo "=== s$n  D=${D}s  nseg=$nseg  start $(date +%H:%M:%S) ===" | tee -a "$LOGS/_summary.log"
  t0=$(date +%s)
  "$VP" run_demo_avatar_single_audio_to_video.py --context_parallel_size=1 \
    --checkpoint_dir="$ROOT/weights/LongCat-Video-Avatar-1.5" --stage_1=ai2v \
    --input_json="$json" --output_dir="$HEADS/tmp_s$n" --resolution=480p --num_segments="$nseg" \
    --use_distill --model_type avatar-v1.5 --use_int8 > "$LOGS/s$n.log" 2>&1
  rc=$?
  # The demo saves segment 1 as ai2v_demo_1.mp4 and CUMULATIVE video_continue_2..N.mp4 (each
  # holds the whole video so far). The highest-numbered video_continue is the COMPLETE head;
  # ai2v_demo_1 alone is only the first 3.7s. Grab the right one + sanity-check the duration.
  tmp="$HEADS/tmp_s$n"
  src=$(ls "$tmp"/video_continue_*.mp4 2>/dev/null | sort -V | tail -1)   # sort -V: numeric-aware, path-underscore-proof
  [ -z "$src" ] && src="$tmp/ai2v_demo_1.mp4"
  if [ -f "$src" ]; then
    mv "$src" "$out"; rm -rf "$tmp"
    hd=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")
    sz=$(ls -la "$out" | awk '{print $5}')
    warn=""; python3 -c "import sys;sys.exit(0 if abs($hd-$D)<4 else 1)" || warn=" *** DUR MISMATCH"
    echo "s$n rc=$rc $(( $(date +%s)-t0 ))s -> ${sz}B  headdur=${hd}s (audio ${D}s)${warn}" | tee -a "$LOGS/_summary.log"
  else
    echo "s$n rc=$rc ERROR no output in $tmp (kept for inspection)" | tee -a "$LOGS/_summary.log"
  fi
done
echo "=== ALL HEADS DONE $(date) ===" | tee -a "$LOGS/_summary.log"