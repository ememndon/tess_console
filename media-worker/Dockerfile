# Tess Demo Studio render worker. Playwright base (Chromium + system deps + fonts),
# plus ffmpeg for compositing and Piper for local neural voiceover. Heavy image
# (~1.5 GB) but isolated from the web app so browser/encode load never touches it.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

# ffmpeg (compose/audio) + caption font + Piper fetch tools + python/espeak for Kokoro.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg fonts-dejavu-core curl ca-certificates xz-utils \
      python3 python3-venv espeak-ng \
    && rm -rf /var/lib/apt/lists/*

# Kokoro-82M (ONNX) — high-quality, natural local neural voice. Installed in an
# isolated venv; model + voices fetched from the kokoro-onnx release. Voice is
# overridable via KOKORO_VOICE (e.g. af_heart, af_bella, am_michael, bf_emma).
RUN python3 -m venv /opt/kokoro-venv \
 && /opt/kokoro-venv/bin/pip install --no-cache-dir kokoro-onnx soundfile numpy
RUN mkdir -p /opt/kokoro \
 && curl -fL -o /opt/kokoro/kokoro-v1.0.onnx \
      https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx \
 && curl -fL -o /opt/kokoro/voices-v1.0.bin \
      https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

# Piper TTS: prebuilt binary + a high-quality single-speaker voice (lessac-high).
# The voice path is overridable via PIPER_VOICE so it can be swapped without rebuild.
RUN set -eux; \
    mkdir -p /opt/piper-voices; \
    curl -fL -o /tmp/piper.tar.gz https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz; \
    tar -xzf /tmp/piper.tar.gz -C /opt; rm /tmp/piper.tar.gz; \
    curl -fL -o /opt/piper-voices/en_US-lessac-high.onnx \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx; \
    curl -fL -o /opt/piper-voices/en_US-lessac-high.onnx.json \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx.json

ENV LD_LIBRARY_PATH=/opt/piper \
    PIPER_BIN=/opt/piper/piper \
    PIPER_VOICE=/opt/piper-voices/en_US-lessac-high.onnx \
    PIPER_ESPEAK=/opt/piper/espeak-ng-data \
    KOKORO_PY=/opt/kokoro-venv/bin/python \
    KOKORO_MODEL=/opt/kokoro/kokoro-v1.0.onnx \
    KOKORO_VOICES=/opt/kokoro/voices-v1.0.bin \
    KOKORO_VOICE=af_sarah \
    KOKORO_SPEED=1.0 \
    VOICE_DEFAULT=kokoro:af_sarah \
    CAPTION_FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf \
    NODE_ENV=production

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
# Bake Remotion's headless Chrome (chrome-headless-shell) into the image so intro/outro
# renders need no network at runtime.
RUN node -e "require('@remotion/renderer').ensureBrowser().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1)})"
COPY . .
# Install the brand display/body fonts as SYSTEM fonts so libass (caption burn-in) can
# render them by name (the kinetic word-by-word captions use Archivo Black).
RUN mkdir -p /usr/share/fonts/truetype/tess \
 && cp remotion/public/fonts/*.ttf /usr/share/fonts/truetype/tess/ \
 && fc-cache -f

CMD ["npx", "tsx", "src/index.ts"]
