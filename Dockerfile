# syntax=docker/dockerfile:1
#
# One image, two roles (see docker-compose.yml):
#   app       Express API + Puppeteer scan engine   node src/server.js
#   frontend  Next.js UI                            next start frontend
# Both roles need the same node_modules (Puppeteer with its Chrome, Next.js).

ARG NODE_VERSION=22

# ---- Stage 1: builder ------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS builder

# Puppeteer downloads Chrome for Testing during npm ci; pin the cache dir so
# the browser can be copied into the production stage.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY frontend ./frontend

# The frontend proxies /api/* to API_ORIGIN. Next.js bakes rewrites into the
# build, so the origin is a build argument.
ARG API_ORIGIN=http://app:3000
ENV API_ORIGIN=${API_ORIGIN}
RUN npm run frontend:build

RUN npm prune --omit=dev

# ---- Stage 2: production ---------------------------------------------------
FROM node:${NODE_VERSION}-slim AS production

ENV NODE_ENV=production \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer \
    SCREENSHOT_DIR=/tmp/screenshots \
    PORT=3000

# Shared libraries for headless Chrome (Puppeteer's Debian dependency list).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      libxss1 \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.cache/puppeteer ./.cache/puppeteer
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/frontend ./frontend

# reports/ is written at runtime and mounted as a volume; /app is root-owned.
RUN mkdir -p /app/reports && chown -R node:node /app/reports

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
