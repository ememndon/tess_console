#!/bin/sh
# Render the §18 architecture graphic at 4K/30fps and encode to a single ProRes 4444
# alpha .mov (one file, ~hundreds of MB, vs thousands of 4K PNGs). Run inside tess-media.
set -e
STAGE=/app/media/showcase-stage/section-18
mkdir -p "$STAGE"
rm -rf /tmp/archframes4k; mkdir -p /tmp/archframes4k
export FPS=30 SCALE=2
cd /app
# animate-arch.mjs writes /tmp/archframes/f%04d.png; point it at the 4k dir via a symlink
rm -rf /tmp/archframes; ln -s /tmp/archframes4k /tmp/archframes
node /tmp/animate-arch.mjs
echo "arch frames: $(ls /tmp/archframes4k | wc -l)"
# encode to alpha ProRes 4444
ffmpeg -y -v error -framerate 30 -i /tmp/archframes4k/f%04d.png \
  -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le "$STAGE/arch-4k.mov"
echo "arch video: $(ffprobe -v error -show_entries format=duration,size -of csv=p=0 "$STAGE/arch-4k.mov")"
rm -rf /tmp/archframes4k /tmp/archframes
echo "ARCH STAGED"
