"""Tess face-restoration service. Runs GFPGAN over a FLUX scene to sharpen and
de-artefact the face (eyes, teeth, skin) BEFORE the thumbnail text is composited.
Reads/writes via the shared media volume (same pattern as the thumb service), so
the app passes absolute paths, not bytes. INTERNAL_SYNC_KEY-guarded, CPU-only."""
import os

import cv2
from flask import Flask, request, jsonify
from gfpgan import GFPGANer

KEY = os.environ.get("INTERNAL_SYNC_KEY", "")
PORT = int(os.environ.get("PORT", "7200"))
# GFPGAN's fidelity vs. quality knob (CodeFormer weight; only used by codeformer
# arch, harmless for the clean arch). Kept conservative so the restored face still
# looks like the generated person.
WEIGHT = float(os.environ.get("FACE_WEIGHT", "0.5"))

# One restorer, loaded once at startup (weights baked into the image at build).
restorer = GFPGANer(
    model_path="/app/weights/GFPGANv1.4.pth",
    upscale=1,  # keep the 1280x720 frame size; we only fix the face, never upscale
    arch="clean",
    channel_multiplier=2,
    bg_upsampler=None,  # background stays as FLUX rendered it (already bokeh)
    device="cpu",  # no GPU on this box; facexlib otherwise defaults to cuda
)

app = Flask(__name__)


def _format_boxes(det_faces):
    """RetinaFace boxes -> [[x1,y1,x2,y2,score], ...] in original image pixels.
    These let the app place the headline on the empty side, away from the face."""
    out = []
    for d in det_faces or []:
        try:
            x1, y1, x2, y2 = float(d[0]), float(d[1]), float(d[2]), float(d[3])
            score = float(d[4]) if len(d) > 4 else 1.0
        except Exception:  # noqa: BLE001
            continue
        out.append([x1, y1, x2, y2, score])
    return out


def _detect(img):
    """Run face detection only (no restoration) and return formatted boxes."""
    fh = restorer.face_helper
    fh.clean_all()
    fh.read_image(img)
    fh.get_face_landmarks_5(only_center_face=False, eye_dist_threshold=5)
    return _format_boxes(fh.det_faces)


@app.get("/health")
def health():
    return jsonify(ok=True)


@app.post("/restore")
def restore():
    if KEY and request.headers.get("x-internal-key") != KEY:
        return jsonify(ok=False, error="forbidden"), 403
    data = request.get_json(force=True, silent=True) or {}
    in_path = data.get("inPath")
    out_path = data.get("outPath") or in_path
    if not in_path or not os.path.exists(in_path):
        return jsonify(ok=False, error="input not found"), 404

    img = cv2.imread(in_path, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify(ok=False, error="cannot read image"), 400

    try:
        # only_center_face=False so a single off-centre subject is still handled;
        # paste_back=True returns the full frame with the face(s) restored in place.
        _, _, restored = restorer.enhance(
            img,
            has_aligned=False,
            only_center_face=False,
            paste_back=True,
            weight=WEIGHT,
        )
    except Exception as e:  # noqa: BLE001 — never crash the worker on one bad image
        return jsonify(ok=False, error=str(e)), 500

    # The detector ran inside enhance(); reuse its boxes so the caller can place text.
    boxes = _format_boxes(restorer.face_helper.det_faces)

    if restored is None:
        # No face detected — nothing to do; leave the scene untouched.
        return jsonify(ok=True, faces=boxes, bytes=os.path.getsize(in_path))

    cv2.imwrite(out_path, restored, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return jsonify(ok=True, faces=boxes, bytes=os.path.getsize(out_path))


@app.post("/detect")
def detect():
    """Face detection only (fast, no restoration) — used for text placement even
    when face restoration is turned off."""
    if KEY and request.headers.get("x-internal-key") != KEY:
        return jsonify(ok=False, error="forbidden"), 403
    data = request.get_json(force=True, silent=True) or {}
    in_path = data.get("inPath")
    if not in_path or not os.path.exists(in_path):
        return jsonify(ok=False, error="input not found"), 404
    img = cv2.imread(in_path, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify(ok=False, error="cannot read image"), 400
    try:
        boxes = _detect(img)
    except Exception as e:  # noqa: BLE001
        return jsonify(ok=False, error=str(e)), 500
    return jsonify(ok=True, faces=boxes)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
