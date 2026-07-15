"""Build-time warm-up: download the matting model so the container runs offline."""
from rembg import new_session

# isnet-general-use: a solid general foreground matting model (much cleaner hair
# edges than the old u2net). Downloaded into U2NET_HOME (baked into the image).
new_session("isnet-general-use")
print("warmup ok")
