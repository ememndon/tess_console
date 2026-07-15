#!/usr/bin/env python3
"""Compose-runner — the GPU half of the capture->compose split.

Takes a capture bundle (produced on the VPS with captureOnly) and finishes it:
per-scene cut from the 4K mezzanine, colour grade, then the overlays that could not be
recorded — burned-in captions, the talking-head circle, and (section 18 only) the
architecture graphic and the two contact cards. NVENC on the rented GPU; libx264 for the
1080p VPS validation pass.

The frame NEVER zooms (owner decision): showcase renders are fixed-frame so the sidebar
gap holding the talking head stays put. See docs/showcase-video/avatar-placement.md.

Everything the runner needs is IN THE BUNDLE:
  body.mp4     4K screencast mezzanine (crf 16)
  bodyVo.wav   mixed voiceover track
  meta.json    scenes[{startMs,durMs,say,voWords[]}], recording.srcOffsetsMs[]

Usage:
  run.py --bundle DIR --out FILE [--height 1080|2160] [--enc libx264|h264_nvenc]
         --avatar PNG                     talking-head still (or a masked LongCat frame seq later)
         [--arch-frames DIR --arch-fps N --arch-at SEC]     section 18 architecture graphic
         [--card-b PNG --card-b-at SEC --card-a PNG --card-a-at SEC]  section 18 contact cards
"""
import argparse, json, os, re, subprocess, sys, tempfile

PREPAD_MS = 350   # VO starts this far into each scene (matches media-worker TIMING.prePadMs)

# --- caption geometry, expressed against a 1920x1080 stage; scaled to the real height ---
CAP_FONT   = 26.0     # px at 1080p (the 60% "clean" size the owner approved)
CAP_MAXCH  = 90
CAP_SPLIT  = 70
CAP_MINSEC = 0.85
CAP_TAILSEC = 0.18
CAP_BOTTOM = 96 + 48  # gap from the bottom edge at 1080p

# talking-head circle in the 1920x1080 frame (avatar-placement.md)
AV_D  = 190.0
AV_CX = 133.8
AV_CY = 915.6


def ff(args):
    r = subprocess.run(["ffmpeg", "-y", "-v", "error", *args], capture_output=True, text=True)
    if r.returncode:
        print("FFMPEG ERROR:\n" + (r.stderr or "(no stderr)")[-2500:], flush=True)
        raise SystemExit(f"ffmpeg failed: {' '.join(args[:6])} ...")


def esc(t):  # ass/drawtext escaping
    return t.replace("\\", "\\\\").replace(":", r"\:").replace("'", r"\'")


def build_cues(scenes):
    """Absolute-timeline caption cues from the bundle's per-scene word timings."""
    words = []
    for sc in scenes:
        base = sc["startMs"] + PREPAD_MS
        for w in (sc.get("voWords") or []):
            words.append({"t": (base + w["startMs"]) / 1000,
                          "e": (base + w["endMs"]) / 1000, "w": w["text"]})
    # group into sentences, then split long sentences at commas, then hard-wrap
    sents, cur = [], []
    for w in words:
        cur.append(w)
        if re.search(r'[.!?]["”]?$', w["w"]):
            sents.append(cur); cur = []
    if cur:
        sents.append(cur)
    groups = []
    for s in sents:
        txt = " ".join(x["w"] for x in s)
        if len(txt) <= CAP_MAXCH:
            groups.append(s); continue
        breaks = [i for i, x in enumerate(s) if re.search(r'[,;:]$', x["w"])]
        parts, last = [], 0
        for bi in breaks:
            if len(" ".join(x["w"] for x in s[last:bi + 1])) >= CAP_SPLIT * 0.55:
                parts.append(s[last:bi + 1]); last = bi + 1
        parts.append(s[last:])
        for p in parts:
            t = " ".join(x["w"] for x in p)
            if len(t) <= CAP_MAXCH:
                groups.append(p); continue
            n = (len(t) // CAP_MAXCH) + 1
            per = (len(p) + n - 1) // n
            for k in range(0, len(p), per):
                groups.append(p[k:k + per])
    cues = []
    for g in groups:
        cues.append({"start": g[0]["t"], "end": g[-1]["e"] + CAP_TAILSEC,
                     "text": " ".join(x["w"] for x in g)})
    for i, c in enumerate(cues):
        if i + 1 < len(cues):
            c["end"] = min(c["end"], cues[i + 1]["start"] - 0.02)
        if c["end"] - c["start"] < CAP_MINSEC and i + 1 < len(cues):
            c["end"] = min(c["start"] + CAP_MINSEC, cues[i + 1]["start"] - 0.02)
    return cues


def write_ass(cues, W, H, path):
    k = H / 1080.0
    fs = round(CAP_FONT * k)
    marginv = round(CAP_BOTTOM * k)
    pad = round(10 * k * (W / 1920))
    def ts(t):
        h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
        return f"{h}:{m:02d}:{s:05.2f}"
    head = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}",
        "WrapStyle: 0", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, "
        "Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        # BorderStyle 4 = opaque box behind the text (BackColour @ ~82% => &HD2 alpha)
        f"Style: Cap,Inter,{fs},&H00FFFFFF,&H00000000,&HD20C0506,0,0,4,{pad},0,2,120,120,{marginv},1",
        "", "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    ev = [f"Dialogue: 0,{ts(c['start'])},{ts(c['end'])},Cap,,0,0,0,,{c['text']}" for c in cues]
    open(path, "w").write("\n".join(head + ev) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--height", type=int, default=2160)
    ap.add_argument("--enc", default="h264_nvenc")
    ap.add_argument("--avatar"); ap.add_argument("--avatar-out", type=float)
    ap.add_argument("--avatar-video", help="talking-head circle as a VIDEO (ring + transparent corners); overrides --avatar still")
    ap.add_argument("--arch-frames"); ap.add_argument("--arch-video"); ap.add_argument("--arch-fps", type=int, default=60)
    ap.add_argument("--arch-at", type=float); ap.add_argument("--arch-dur", type=float)
    ap.add_argument("--card-b"); ap.add_argument("--card-b-at", type=float)
    ap.add_argument("--card-a"); ap.add_argument("--card-a-at", type=float)
    ap.add_argument("--no-captions", action="store_true")
    ap.add_argument("--x264-preset", default="medium", help="libx264 preset (CPU encode)")
    ap.add_argument("--x264-crf", default="18", help="libx264 crf (CPU encode)")
    ap.add_argument("--cap-pngs", help="dir of timed Inter caption PNGs + cues.json")
    ap.add_argument("--dump-cues", help="write build_cues() to this path and exit")
    a = ap.parse_args()

    if a.dump_cues:
        meta = json.load(open(os.path.join(a.bundle, "meta.json")))
        json.dump(build_cues(meta["scenes"]), open(a.dump_cues, "w"), indent=1, ensure_ascii=False)
        print(f"[runner] {a.dump_cues}")
        return

    meta = json.load(open(os.path.join(a.bundle, "meta.json")))
    scenes = meta["scenes"]
    src = meta["recording"]["srcOffsetsMs"]
    body = os.path.join(a.bundle, meta["body"])
    vo = os.path.join(a.bundle, meta["bodyVo"])
    H = a.height; W = H * 16 // 3 // 3  # 16:9 -> keep integer
    W = round(H * 16 / 9)
    enc = ["-c:v", a.enc, "-preset", "p5", "-rc", "vbr", "-cq", "20"] if "nvenc" in a.enc \
        else ["-c:v", "libx264", "-preset", a.x264_preset, "-crf", a.x264_crf]
    grade = f"scale={W}:{H}:flags=lanczos,setsar=1,eq=contrast=1.06:saturation=1.12," \
            f"unsharp=5:5:0.5:5:5:0.0"

    work = tempfile.mkdtemp(prefix="compose_")
    segs = []
    print(f"[runner] {len(scenes)} scenes -> {W}x{H} via {a.enc}")
    for i, sc in enumerate(scenes):
        ss = src[i] / 1000.0
        # Force an EXACT output frame count instead of -t. Cutting a 30fps mezzanine and
        # re-timing to 60fps with -t rounds each segment up a few frames; over a long
        # section that accumulates into visible caption drift. round(dur*60) frames at
        # 60fps is exact, so sum(segments) == sum(durMs) to within one frame.
        nframes = round(sc["durMs"] / 1000.0 * 60)
        seg = os.path.join(work, f"s{i:02d}.mp4")
        ff(["-ss", f"{ss:.3f}", "-i", body,
            "-vf", grade, "-an", "-r", "60", "-frames:v", str(nframes),
            "-vsync", "cfr", *enc, "-pix_fmt", "yuv420p", seg])
        segs.append(seg)
    lst = os.path.join(work, "list.txt")
    open(lst, "w").write("\n".join(f"file '{s}'" for s in segs))
    bodyv = os.path.join(work, "body.mp4")
    ff(["-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", bodyv])

    total = sum(s["durMs"] for s in scenes) / 1000.0

    # Build the caption track as ONE alpha video by CONCATENATION, not overlay. Captions
    # never overlap in time, so the timeline is a strict sequence: [transparent gap][cue 0]
    # [gap][cue 1]...[final gap]. Each piece is one tiny ffmpeg call reading at most ONE
    # image, so memory is flat and the whole track is encoded exactly ONCE (concat is a
    # stream copy). This replaces overlaying dozens of looped 4K PNGs in one graph (OOM) and
    # the earlier per-batch full-track rewrite (encoded the 150s track N times — 8 min/batch).
    caption_track = None
    if a.cap_pngs:
        cues = json.load(open(os.path.join(a.cap_pngs, "cues.json")))
        codec = ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le"]
        segs = []
        cursor = 0.0

        def gap(dur):
            if dur <= 0.001:
                return
            p = os.path.join(work, f"cg{len(segs):04d}.mov")
            # A transparent filler. NOTE: color=c=black@0.0 does NOT survive as alpha=0 into
            # the prores yuva plane (it re-fills opaque black, blanking the whole frame during
            # every caption gap). Forcing the alpha plane to 0 with colorchannelmixer=aa=0 is
            # the only construction that stays transparent. Verified on the H100 box 2026-07-11.
            ff(["-f", "lavfi", "-i", f"color=c=black:s={W}x{H}:r=60", "-t", f"{dur:.3f}",
                "-vf", "format=yuva444p10le,colorchannelmixer=aa=0", *codec, p])
            segs.append(p)

        for i, c in enumerate(cues):
            gap(c["start"] - cursor)
            p = os.path.join(work, f"cs{len(segs):04d}.mov")
            ff(["-loop", "1", "-i", os.path.join(a.cap_pngs, f"c{i:03d}.png"),
                "-t", f"{max(0.05, c['end'] - c['start']):.3f}",
                "-vf", f"scale={W}:{H},format=yuva444p10le", "-r", "60", *codec, p])
            segs.append(p); cursor = c["end"]
        gap(total - cursor)

        lst = os.path.join(work, "caplist.txt")
        open(lst, "w").write("\n".join(f"file '{s}'" for s in segs))
        caption_track = os.path.join(work, "captrack.mov")
        ff(["-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", caption_track])
        print(f"[runner] caption track: {len(cues)} cues, {len(segs)} segments, encoded once")

    # ---- final overlay pass: arch + avatar + cards + caption-track, all bounded input count ----
    inputs = ["-i", bodyv]
    fc = []
    label = "[0:v]"
    idx = 1

    # architecture graphic (section 18) placed at an absolute time. Either a PNG sequence
    # (--arch-frames) or a single alpha video (--arch-video, preferred: one file, small).
    if a.arch_video and a.arch_at is not None:
        inputs += ["-i", a.arch_video]
        fc.append(f"[{idx}:v]fps=60,setpts=PTS-STARTPTS+{a.arch_at}/TB,scale={W}:{H}[arch]")
        fc.append(f"{label}[arch]overlay=0:0:eof_action=pass[vg]")
        label = "[vg]"; idx += 1
    elif a.arch_frames and a.arch_at is not None:
        inputs += ["-framerate", str(a.arch_fps), "-i", os.path.join(a.arch_frames, "f%04d.png")]
        fc.append(f"[{idx}:v]fps=60,setpts=PTS-STARTPTS+{a.arch_at}/TB,scale={W}:{H}[arch]")
        fc.append(f"{label}[arch]overlay=0:0:eof_action=pass[vg]")
        label = "[vg]"; idx += 1

    # talking-head circle in the sidebar gap. --avatar-video is the LongCat clip already
    # masked into a ring with transparent corners (real talking head); --avatar is the still
    # PNG fallback. --avatar-out fades it away before the §18 contact cards (one face on screen).
    if a.avatar_video or a.avatar:
        k = H / 1080.0
        d = round(AV_D * k); x = round((AV_CX - AV_D / 2) * k); y = round((AV_CY - AV_D / 2) * k)
        if a.avatar_video:
            inputs += ["-i", a.avatar_video]            # a real video: do NOT loop
        else:
            inputs += ["-loop", "1", "-i", a.avatar]    # a still: loop it
        if a.avatar_out is not None:
            fc.append(f"[{idx}:v]scale={d}:{d},format=rgba,"
                      f"fade=t=out:st={a.avatar_out - 0.5:.3f}:d=0.5:alpha=1[av]")
        else:
            fc.append(f"[{idx}:v]scale={d}:{d},format=rgba[av]")
        fc.append(f"{label}[av]overlay={x}:{y}:eof_action=pass[va]")
        label = "[va]"; idx += 1

    # contact cards (section 18): fade in, then hold to the end
    for tag, png, at in (("b", a.card_b, a.card_b_at), ("a", a.card_a, a.card_a_at)):
        if png and at is not None:
            inputs += ["-loop", "1", "-i", png]
            fc.append(f"[{idx}:v]scale={W}:{H},format=rgba,"
                      f"fade=t=in:st={at}:d=0.6:alpha=1[card{tag}]")
            fc.append(f"{label}[card{tag}]overlay=0:0:eof_action=pass[vc{tag}]")
            label = f"[vc{tag}]"; idx += 1

    # captions (single pre-built alpha track), on top of everything
    if caption_track:
        inputs += ["-i", caption_track]
        fc.append(f"{label}[{idx}:v]overlay=0:0:eof_action=pass[vcap]")
        label = "[vcap]"; idx += 1
    elif not a.no_captions:
        cues = build_cues(scenes)
        ass = os.path.join(work, "caps.ass")
        write_ass(cues, W, H, ass)
        fc.append(f"{label}ass={ass}[vcap]")
        label = "[vcap]"
        print(f"[runner] {len(cues)} caption cues (libass)")

    filt = ";".join(fc) if fc else None
    args = [*inputs, "-i", vo]
    if filt:
        args += ["-filter_complex", filt, "-map", label]
    else:
        args += ["-map", "0:v"]
    audio_idx = idx  # vo is the last input
    # Authoritative length = sum of scene budgets (== bodyVo length, computed above as
    # `total`). -shortest is unreliable when the video comes from looped-image overlays
    # (it let the tail run ~0.85s long), so cap explicitly. Alignment is from t=0.
    args += ["-map", f"{audio_idx}:a", "-r", "60", "-t", f"{total:.3f}", *enc,
             "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", a.out]
    ff(args)
    print(f"[runner] wrote {a.out}")


if __name__ == "__main__":
    main()
