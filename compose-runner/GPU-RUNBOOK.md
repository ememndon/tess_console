# GPU render runbook — showcase video

The VPS did its half (capture + staging). Everything below runs on a rented GPU box, where
cores + RAM are plentiful and ffmpeg has NVENC. Nothing here should ever run on the VPS.

## What to rent

An H100 box (the LongCat avatar model wants it). ffmpeg with `h264_nvenc` — standard on any
CUDA image (`nvidia/cuda` + `apt install ffmpeg`, or a prebuilt ffmpeg-nvenc image). Also:
python3, node 20+ (for the two browser-render helpers, if we regenerate any staged asset).

## Transfer from the VPS (~2.6 GB, one time)

From the GPU box, pull the staged set:

    rsync -aP <vps>:/opt/tess-console/media/showcase-capture/ ./showcase-capture/   # 865M, 18 bundles
    rsync -aP <vps>:/opt/tess-console/media/showcase-stage/    ./showcase-stage/     # 1.7G, captions+arch+cards
    rsync -aP <vps>:/opt/tess-console/compose-runner/          ./compose-runner/     # the runner + scripts
    rsync -aP <vps>:/opt/tess-console/docs/showcase-video/     ./docs/showcase-video/ # beat maps, manifest, endcard, arch

(the media/ paths are the container's /app/media — on the VPS host they live under the
tess-media volume; `docker cp tess-media:/app/media/... ` if the volume path is not exposed.)

## Order of operations (front-load the fast wins)

### 1. Validate the runner at 4K on ONE section (minutes)
    python3 compose-runner/run.py \
      --bundle showcase-capture/fcbfdddb-.../16x9uhd --out /tmp/s15-4k.mp4 \
      --height 2160 --enc h264_nvenc \
      --avatar showcase-stage/avatar-ring-4k-still.png \
      --cap-pngs showcase-stage/section-15/captions-4k
Then §18 with all overlays:
      ... --arch-video showcase-stage/section-18/arch-4k.mov --arch-at 37.82 \
          --card-b .../card-B-4k.png --card-b-at 124.47 --card-a .../card-A-4k.png --card-a-at 145.48 \
          --avatar-out 124.47 --cap-pngs showcase-stage/section-18/captions-4k
If anything errors, fix it here — the box is fast, iteration is cheap.

### 2. Compose ALL 18 at 4K/NVENC (with the STILL avatar → a COMPLETE draft master)
One command per section (manifest in docs/showcase-video/capture-manifest.json maps
section→bundle). Only §18 takes the arch/cards/avatar-out flags. Produces 18 finished 4K
section videos. This is the whole video minus the lip-synced talking head.

### 3. Stitch → draft 4K master
Concatenate the 18 with short cross-dissolves and chapter markers off the section
boundaries. **NO music** — owner's project-wide rule (review-notes.md line 9: "No music
anywhere in the project ... keep it out of the final composite too"). (Script to be written
on the box — pure ffmpeg xfade + concat + metadata.)

### 4. LongCat talking head (the only true GPU/CUDA step)
Generate the lip-synced avatar from avatar_new.png + each section's bodyVo.wav. Mask each
into the 380px sidebar circle (centre 267.6/1831.2 at 4K — see docs/showcase-video/avatar-placement.md),
and into the §18 card circles. Re-run the compose avatar layer with the LongCat frames in
place of avatar-ring-4k-still.png. Wipe avatar_new.png + the model afterward.

### 5. Final master + 1080p derivative, then tear the box down.

## Key facts the runner encodes (so nothing regresses)
- Frame is FIXED — no zoom (avatar-placement.md). The runner suppresses it for `bare`.
- Captions: clean Inter pill, 60% scale, built as a concat alpha track (memory-flat).
- Card A is opaque rgb24 full-frame (correct); card B is rgba over the blurred console.
- §06 features GlobalResumeHub posts only.
- Per-scene cut uses exact frame counts (no -t drift); output capped at sum(durMs).
