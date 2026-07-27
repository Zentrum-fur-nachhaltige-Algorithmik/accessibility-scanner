# syntax=docker/dockerfile:1
#
# Web Accessibility Checker — host-agnostic container image.
#
# The app is two processes sharing one codebase and one package.json:
#   - Express API + Puppeteer scan engine (src/server.js)
#   - Next.js frontend (frontend/, built via `npm run frontend:build`,
#     served via `next start frontend`)
#
# src/server.js does NOT serve the built frontend (it only serves /reports
# and the /api/* routes — see routes in src/server.js). frontend/next.config.js
# proxies the frontend's /api/* calls to a HARDCODED `http://localhost:3000`
# (see the `rewrites()` config), not a service hostname. That means the two
# processes must share a network namespace for the proxy to work without
# editing frontend source. This image is built once and run twice (see
# docker-compose.yml): as the `app` service (default CMD, the API) and as the
# `frontend` service (CMD overridden to `next start`, joined to the app
# service's network via `network_mode: service:app`).
#
# This is one image, two roles — not two images — since both roles need the
# same node_modules (Puppeteer + its downloaded Chrome, Next.js, etc.).

ARG NODE_VERSION=22

# ─────────────────────────────────────────────────────────────────────────
# Stage 1: builder — install deps, download Puppeteer's Chrome, build Next.js
# ─────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS builder

# Puppeteer (top-level dep, v22) downloads "Chrome for Testing" during
# `npm ci`'s postinstall step. Pin the cache dir so we can copy the already-
# downloaded browser into the production stage instead of re-downloading it.
# (html-pdf-node's own nested/older puppeteer dependency stores its Chromium
# build inside node_modules itself, so it travels with the node_modules copy
# below with no extra handling needed.)
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

WORKDIR /app

# ca-certificates: needed for the https download of Chrome during npm ci.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install with lockfile first so this layer is cached unless deps change.
COPY package.json package-lock.json ./
RUN npm ci

# Now bring in the rest of the source needed to build the frontend.
COPY src ./src
COPY frontend ./frontend

RUN npm run frontend:build

# devDependencies (vitest) aren't needed at runtime; drop them to shrink the
# node_modules directory that gets copied into the production stage.
RUN npm prune --omit=dev

# ─────────────────────────────────────────────────────────────────────────
# Stage 2: production — minimal runtime image
# ─────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS production

ENV NODE_ENV=production \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer \
    PORT=3000

# Debian packages required to run headless Chrome (Puppeteer's documented
# Debian/Ubuntu dependency list). These are shared libraries only — Chrome
# itself is the binary Puppeteer already downloaded in the builder stage, not
# an apt "chromium" package.
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

# The `node` user/group (uid/gid 1000, home /home/node) already exists in the
# base image; run as non-root.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.cache/puppeteer ./.cache/puppeteer
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/frontend ./frontend

# ReportGenerator's constructor unconditionally fs.ensureDir()s both of these
# at startup (ensureDirectories() in src/report-generator.js) — /app itself
# is root-owned (created implicitly by WORKDIR before USER node below), so
# without this the non-root user gets EACCES on first request and the
# process crashes. reports/ is also the mount point for the `reports` named
# volume in docker-compose.yml; templates/ is empty in this repo today
# (ReportGenerator falls back to a built-in template when a named template
# file is missing) but must still exist and be writable.
RUN mkdir -p /app/reports /app/templates && chown -R node:node /app/reports /app/templates

USER node

# The API listens on 3000 (fixed — see the note above about the frontend's
# hardcoded proxy destination). The frontend service (same image, overridden
# CMD) listens on 3001; see docker-compose.yml.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
