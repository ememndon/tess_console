#!/bin/bash
# Mask a LongCat head video into the approved avatar ring (reusing avatar-ring-4k-still.png for
# the exact gradient band + dark border + transparent corners), output as a prores-4444 alpha
# video for run.py --avatar-video. The head circle (754px) covers the still face; only the ring
# band shows from the base. Usage: avatar-ring.sh HEAD.mp4 OUT.mov
set -eu
HEAD=$1; OUT=$2
RING=/workspace/showcase/media/showcase-stage/avatar-ring-4k-still.png
WORK=$(mktemp -d)
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$HEAD")
# circular mask (one frame, instant) — radius 376 in a 754 canvas
ffmpeg -nostdin -hide_banner -loglevel error -f lavfi -i color=black:s=754x754 \
  -vf "format=gray,geq=lum='if(lte(hypot(X-377,Y-377),376),255,0)'" -frames:v 1 "$WORK/mask.png" -y
# crop face (rect from endcard README, rescaled to 640x608) -> circle -> overlay on ring -> yuva
ffmpeg -nostdin -hide_banner -loglevel error -loop 1 -i "$RING" -i "$HEAD" -i "$WORK/mask.png" \
  -filter_complex "
    [1:v]crop=376:376:126:53,scale=754:754,format=rgba[hc];
    [hc][2:v]alphamerge[head];
    [0:v][head]overlay=(W-w)/2:(H-h)/2:format=auto,format=yuva444p10le[out]" \
  -map "[out]" -an -t "$DUR" -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le "$OUT" -y
rm -rf "$WORK"
echo "avatar ring: $OUT  ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s)"