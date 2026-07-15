# Tess thumbnail-render worker. Debian (node-canvas ships prebuilt binaries here,
# unlike Alpine/musl) running Fabric.js. Isolated from the web app like rembg /
# media-worker so the native graphics stack never touches the Next build.
FROM node:22-bookworm-slim

WORKDIR /app

# Runtime libraries node-canvas (Cairo/Pango) links against, plus build tools as a
# fallback in case a prebuilt binary isn't available for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 libpixman-1-0 \
      build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev libpixman-1-dev pkg-config python3 \
      fontconfig fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production PORT=7100
EXPOSE 7100
CMD ["node", "server.js"]
