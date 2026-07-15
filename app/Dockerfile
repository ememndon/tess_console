# Build and runtime for the Tess Console app (Next.js standalone output).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
# Fonts for SVG→PNG banner text (sharp/fontconfig) + ffmpeg for templated video.
RUN apk add --no-cache fontconfig ttf-dejavu ffmpeg
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Offline GeoIP database (DB-IP IP-to-Country Lite) read at runtime by the
# analytics ingest for the Audience → Countries breakdown. Data files aren't
# traced into the standalone output, so copy it explicitly.
COPY --from=build /app/data ./data
# sharp is a native module kept external from the bundle — copy it (and its musl
# binary) explicitly so standalone tracing never drops it.
COPY --from=build /app/node_modules/sharp ./node_modules/sharp
COPY --from=build /app/node_modules/@img ./node_modules/@img
USER node
EXPOSE 3000
CMD ["node", "server.js"]
