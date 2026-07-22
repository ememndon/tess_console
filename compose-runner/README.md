# compose-runner: the GPU half of the capture→compose split

The VPS captures each section at 4K and STOPS (captureOnly), leaving a self-contained bundle
in `media/showcase-capture/<jobId>/16x9uhd/`. This runner finishes it. It is meant to run on
the rented GPU with NVENC; the same script runs at 1080p/libx264 for validation on the VPS.

Composing 4K on the VPS is NOT allowed. It has 4 CPU cores, no GPU, and the live console runs there.
See memory: gpu-scope-showcase.

## What the runner does, per section

1. Cut each scene from `body.mp4` at `recording.srcOffsetsMs[i]` for `durMs`, an EXACT
   `round(durMs/1000*60)` frames (never `-t`, which rounds up and drifts). Colour grade.
   No zoom, because the frame is fixed (avatar-placement.md).
2. Concat → body video, capped at `sum(durMs)` (== bodyVo length; `-shortest` is unreliable
   with looped-image overlays and let the tail run ~0.85s long).
3. Overlays, in z-order: architecture graphic (§18) → talking-head circle → contact cards
   (§18) → captions.
4. Mux `bodyVo.wav`.

Captions come from `meta.scenes[].voWords` (per-scene word timings already in the bundle) via
`build_cues()` does sentence-first chunking, comma splits, and hard-wrap at 90 chars. Two render
paths: `--cap-pngs` (browser-rendered Inter PNGs, font-exact, the approved look) or libass
fallback. Use PNGs; the container has no Inter TTF.

## Inputs

    body.mp4 / bodyVo.wav / meta.json     the bundle (on disk)
    avatar-ring.png                        talking-head circle (still now; masked LongCat later)
    arch frames + cues + cards             §18 only

## Validation pass (VPS, 1080p), done for §15

    python3 run.py --bundle DIR --out x --dump-cues cues.json        # cues from the bundle
    node caption-pngs.mjs cues.json capsdir 1080                     # Inter caption PNGs
    node make-avatar-ring.mjs                                        # ringed circular still
    python3 run.py --bundle DIR --out s15-proof.mp4 \
      --height 1080 --enc libx264 --avatar avatar-ring.png --cap-pngs capsdir

§15 proof: 6 scenes, 36.35s (audio 36.338, within one frame, no drift). Avatar seated in the
sidebar gap under "Tess (Agent)"; captions in the clean Inter pill, synced to the voice.

## GPU pass (per section)

    python3 run.py --bundle DIR --out sNN.mp4 --height 2160 --enc h264_nvenc \
      --avatar <masked-longcat-frames-or-still> --cap-pngs <4K caps> \
      [§18: --arch-frames DIR --arch-at 37.82 --card-b B.png --card-b-at 124.47 \
            --card-a A.png --card-a-at 145.48]

Then stitch the 18 outputs with cross-dissolves, music bed and chapter markers (separate step).
