# GFPGAN face-restoration worker. Python + CPU PyTorch. Heavy + isolated (like the
# media/thumb workers) so the model stack never touches the web app's Alpine image.
FROM python:3.10-slim

ENV PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch + torchvision, pinned to a basicsr-compatible pair (torchvision
# 0.16+ removed transforms.functional_tensor, which basicsr 1.4.2 still imports).
RUN pip install torch==2.0.1 torchvision==0.15.2 --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install -r requirements.txt

# Bake the GFPGAN weights into the image so the container runs fully offline.
RUN mkdir -p /app/weights && \
    wget -q -O /app/weights/GFPGANv1.4.pth \
      https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth

COPY warmup.py server.py ./
# Pull the detection/parsing weights too (and validate the whole stack imports).
RUN python warmup.py

EXPOSE 7200
# Single worker, long timeout: CPU restoration of a 1280x720 frame takes seconds.
CMD ["gunicorn", "-b", "0.0.0.0:7200", "-w", "1", "--timeout", "120", "server:app"]
