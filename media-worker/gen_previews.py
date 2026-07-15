#!/usr/bin/env python3
# Generate a short preview clip for every Kokoro voice (for the Demo Studio voice
# picker). Usage: gen_previews.py <model.onnx> <voices.bin> <outdir> <text>
import sys
import os
import soundfile as sf
from kokoro_onnx import Kokoro

def main():
    model, voices, outdir, text = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    os.makedirs(outdir, exist_ok=True)
    k = Kokoro(model, voices)
    names = sorted(k.get_voices()) if hasattr(k, "get_voices") else sorted(getattr(k, "voices", {}).keys())
    for n in names:
        try:
            s, sr = k.create(text, voice=n, speed=1.0, lang="en-us")
            sf.write(os.path.join(outdir, n + ".wav"), s, sr)
            print("ok", n, flush=True)
        except Exception as e:
            print("FAIL", n, str(e)[:80], flush=True)

if __name__ == "__main__":
    main()
