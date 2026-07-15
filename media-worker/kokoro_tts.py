#!/usr/bin/env python3
# Kokoro-82M batch text-to-speech. Loads the ONNX model once and synthesizes every
# line in the manifest, so a whole demo's narration costs one model load.
# Usage: kokoro_tts.py <model.onnx> <voices.bin> <voice> <speed> <manifest.json>
# manifest.json = [{"text": "...", "out": "/abs/path.wav"}, ...]
import sys
import json
import soundfile as sf
from kokoro_onnx import Kokoro

def main():
    model, voices, voice, speed, manifest_path = (
        sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), sys.argv[5],
    )
    with open(manifest_path) as f:
        items = json.load(f)
    k = Kokoro(model, voices)
    for it in items:
        text = (it.get("text") or "").strip()
        if not text:
            continue
        samples, sr = k.create(text, voice=voice, speed=speed, lang="en-us")
        sf.write(it["out"], samples, sr)
    print("kokoro: synthesized", len(items), "lines", flush=True)

if __name__ == "__main__":
    main()
