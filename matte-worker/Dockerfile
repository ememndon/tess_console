# Matte (background-removal) worker. rembg + onnxruntime on CPU. Isolated like the
# other Python workers so its stack never touches the web app.
FROM python:3.11-slim

ENV PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1 U2NET_HOME=/app/models

RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# rembg[cpu] pulls onnxruntime + pymatting (for alpha matting) + the usual stack.
RUN pip install "rembg[cpu]==2.0.59"

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY warmup.py server.py ./
RUN python warmup.py   # bakes the isnet model into /app/models

EXPOSE 7300
CMD ["gunicorn", "-b", "0.0.0.0:7300", "-w", "1", "--timeout", "180", "server:app"]
