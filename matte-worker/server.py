"""Tess matte service. Cuts the subject out of an image (background removal /
alpha matting) and returns a transparent PNG, so the app can composite the person
onto a designed layout at a fixed edge position. Isolated like the other workers;
INTERNAL_SYNC_KEY-guarded; reads/writes via the shared media volume."""
import os

from flask import Flask, request, jsonify
from PIL import Image
from rembg import remove, new_session

KEY = os.environ.get("INTERNAL_SYNC_KEY", "")
PORT = int(os.environ.get("PORT", "7300"))

# One session loaded at startup (weights baked into the image at build).
SESSION = new_session("isnet-general-use")

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify(ok=True)


@app.post("/matte")
def matte():
    if KEY and request.headers.get("x-internal-key") != KEY:
        return jsonify(ok=False, error="forbidden"), 403
    data = request.get_json(force=True, silent=True) or {}
    in_path = data.get("inPath")
    out_path = data.get("outPath")
    if not in_path or not out_path or not os.path.exists(in_path):
        return jsonify(ok=False, error="inPath/outPath required (input must exist)"), 400
    try:
        img = Image.open(in_path).convert("RGB")
        # alpha_matting gives softer, cleaner edges (esp. hair) via pymatting.
        cut = remove(
            img,
            session=SESSION,
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=10,
            alpha_matting_erode_size=10,
            post_process_mask=True,
        )  # RGBA
        cut.save(out_path, "PNG")
    except Exception as e:  # noqa: BLE001
        return jsonify(ok=False, error=str(e)), 500
    return jsonify(ok=True, bytes=os.path.getsize(out_path))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
