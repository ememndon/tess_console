#!/bin/bash
# Stitch the 18 composed sections into one master. NO MUSIC (owner project-wide rule).
# Chapter markers at section boundaries, titled from the beat-map `feature` fields.
#
# Usage: stitch.sh MODE OUT
#   MODE=concat  hard-cut, stream-copy (instant) — used for the draft master
#   MODE=xfade   0.4s cross-dissolves, re-encode — used for the final master
set -u
MODE=${1:-concat}
OUT=${2:-/workspace/showcase/out/master-4k.mp4}
ROOT=/workspace/showcase; O=$ROOT/out; W=$ROOT/work; mkdir -p "$W"
XF=0.4  # cross-dissolve seconds (xfade mode)

TITLES=("Cold Open" "Site Overview" "Analytics" "Content Director" "Demo Studio" \
"Social Studio" "SEO Center" "Competitors" "Inbox" "Outreach CRM" "Site Health" \
"Feedback" "Playbooks" "Jobs Monitor" "Audit Log" "Tess (Agent)" "Settings and Security" "Close")

FILES=(); for n in $(seq -w 1 18); do
  f="$O/s$n-4k.mp4"; [ -f "$f" ] || { echo "MISSING $f"; exit 1; }; FILES+=("$f"); done
DUR=(); for f in "${FILES[@]}"; do DUR+=("$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"); done

# ---- chapter metadata (boundaries = cumulative section durations; xfade shrinks each gap by XF) ----
meta=$W/chapters.txt; echo ";FFMETADATA1" > "$meta"
acc=0.0
for i in "${!FILES[@]}"; do
  s_ms=$(python3 -c "print(int(round($acc*1000)))")
  acc=$(python3 -c "print($acc + ${DUR[$i]} - (${XF} if '$MODE'=='xfade' and $i>0 else 0))")
  e_ms=$(python3 -c "print(int(round($acc*1000)))")
  { echo "[CHAPTER]"; echo "TIMEBASE=1/1000"; echo "START=$s_ms"; echo "END=$e_ms"; echo "title=${TITLES[$i]}"; } >> "$meta"
done

if [ "$MODE" = "concat" ]; then
  list=$W/concat.txt; : > "$list"
  for f in "${FILES[@]}"; do echo "file '$f'" >> "$list"; done
  # stream-copy concat (all sections share encoder params). If a player shows timestamp
  # glitches at a boundary, re-run with re-encode fallback below.
  ffmpeg -nostdin -y -v error -f concat -safe 0 -i "$list" -i "$meta" -map_metadata 1 \
    -c copy -movflags +faststart "$OUT" \
    || { echo "stream-copy failed; re-encoding concat"; \
         ffmpeg -nostdin -y -v error -f concat -safe 0 -i "$list" -i "$meta" -map_metadata 1 \
           -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart "$OUT"; }
elif [ "$MODE" = "xfade" ]; then
  # Chain xfade (video) + acrossfade (audio) across the 18 clips.
  # Chained-offset formula: adding clip j (j=1..17), the running output already spans
  # sum(dur[0..j-1]) - (j-1)*XF, so the fade starts XF before its end:
  #   offset_j = sum(dur[0..j-1]) - j*XF
  inputs=(); for f in "${FILES[@]}"; do inputs+=(-i "$f"); done
  fc=$(python3 -c "
durs=[${DUR[@]// /,}]; XF=$XF; n=len(durs)
vlab='[0:v]'; alab='[0:a]'; parts=[]
for j in range(1,n):
    off=sum(durs[:j]) - j*XF
    nv=f'[v{j}]'; na=f'[a{j}]'
    parts.append(f'{vlab}[{j}:v]xfade=transition=fade:duration={XF}:offset={off:.4f}{nv}')
    parts.append(f'{alab}[{j}:a]acrossfade=d={XF}{na}')
    vlab, alab = nv, na
print(';'.join(parts))
print('MAPV='+vlab); print('MAPA='+alab)
")
  mapv=$(echo "$fc" | sed -n 's/^MAPV=//p'); mapa=$(echo "$fc" | sed -n 's/^MAPA=//p')
  fc=$(echo "$fc" | grep -v '^MAP')
  ffmpeg -nostdin -y -v error "${inputs[@]}" -i "$meta" \
    -filter_complex "$fc" -map "$mapv" -map "$mapa" -map_metadata 18 \
    -c:v libx264 -preset slow -crf 17 -c:a aac -b:a 192k -movflags +faststart "$OUT"
else
  echo "unknown MODE $MODE"; exit 2
fi
echo "wrote $OUT"
echo "duration: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")"
echo "chapters: $(ffprobe -v error -show_chapters -of csv "$OUT" 2>/dev/null | grep -c chapter)"