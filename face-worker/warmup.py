"""Build-time warm-up: pull every model weight into the image so the running
container is fully offline (no surprise downloads on the first real request)."""
from facexlib.detection import init_detection_model
from facexlib.parsing import init_parsing_model
from gfpgan import GFPGANer

# Face detection (retinaface) + face parsing (parsenet) used by GFPGAN's helper.
# device="cpu": this box has no GPU, and facexlib defaults to cuda.
init_detection_model("retinaface_resnet50", device="cpu")
init_parsing_model("parsenet", device="cpu")

# Construct the restorer once so the GFPGAN arch weights are loaded/validated.
GFPGANer(
    model_path="/app/weights/GFPGANv1.4.pth",
    upscale=1,
    arch="clean",
    channel_multiplier=2,
    bg_upsampler=None,
    device="cpu",
)
print("warmup ok")
