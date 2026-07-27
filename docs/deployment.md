# Deployment

Host-agnostic container deployment for the accessibility checker: an Express
API that drives Puppeteer-based scanners, plus a Next.js frontend. Ships as
one Docker image, run in two roles (see [Architecture](#architecture)).

Files: `Dockerfile`, `docker-compose.yml`, `.dockerignore` (repo root).

## Prerequisites

- Docker Engine with the `docker compose` (v2) plugin.
- At least **2GB of RAM** available to the containers — Chrome under
  Puppeteer is the memory-heavy part of this app, not Node itself.
- An OpenRouter API key if you want the LLM-powered scanners (they're
  conditionally registered — the app runs fine without one, just with fewer
  scanners; see `src/scanner-registry.js`).

## Quick start

```bash
# 1. Environment file — docker compose auto-loads .env from this directory.
#    This repo already has one with OPENROUTER_API_KEY; add the rest (see the
#    reference table below):
cat >> .env <<'EOF'
API_TOKEN=change-me-to-a-long-random-string
SCAN_ALLOWED_HOSTS=example.com,another-allowed-host.com
SCAN_CONCURRENCY=1
EOF

# 2. Build the image (compiles the Next.js frontend as part of the build).
docker compose build

# 3. Run both services.
docker compose up -d

# 4. Verify.
curl -f http://localhost:3000/api/health
open http://localhost:3001    # frontend UI
```

To build/run without Compose:

```bash
docker build -t accessability:latest .

docker run -d --name accessability-app \
  -p 3000:3000 --shm-size=1gb --memory=2g \
  -e OPENROUTER_API_KEY -e API_TOKEN -e SCAN_ALLOWED_HOSTS -e SCAN_CONCURRENCY \
  -v accessability-reports:/app/reports \
  accessability:latest

# Frontend must share the app container's network namespace — see
# "Why two services, one image" below.
docker run -d --name accessability-frontend \
  --network container:accessability-app \
  accessability:latest \
  node_modules/.bin/next start frontend -p 3001
```

## Architecture

### Why two services, one image

`src/server.js` (the Express API) does not serve the built Next.js frontend
— it only serves `/api/*` routes and static files under `/reports`. The
frontend is a second Node process (`next start frontend`), built from the
**same** `package.json` (there's no `frontend/package.json` — the frontend
is invoked via the root `frontend:build` / `frontend:start` npm scripts), so
it makes sense as a second run of the same image rather than a second image.

`frontend/next.config.js` proxies the frontend's `/api/*` calls to
`process.env.API_ORIGIN || 'http://localhost:3000'`.

⚠️ Next.js bakes rewrites into `routes-manifest.json` at **build** time, so
`API_ORIGIN` must be set for `next build` (a Docker **build arg** / builder-stage
env), not just at `next start`. With `API_ORIGIN` unset, the baked default is
`localhost`, not a compose service hostname — in a normal two-container
Compose setup that would resolve to the frontend container itself and 404.
Rather than edit frontend source to use a service hostname, the `frontend`
service in `docker-compose.yml` joins the `app` service's network namespace
via `network_mode: "service:app"`, so `localhost:3000` inside the frontend
container really does reach the Express API. The trade-off: ports can only be
published from `app` (Compose forbids `ports:` on a service using
`network_mode: service:*`), so both `3000` (API) and `3001` (frontend) are
published on the `app` service block.

If `src/server.js` is ever changed to serve the built frontend directly
(e.g. `express.static('frontend/.next')` + a catch-all route), this whole
second service — and the `network_mode` workaround — goes away and `docker
run`/a single Compose service is enough. That's the preferred end state; this
setup is the interim one that requires no source changes.

### Puppeteer/Chrome

Puppeteer (`^22.15.0`) downloads its own "Chrome for Testing" binary during
`npm ci` (postinstall) rather than relying on a Debian `chromium` package. The
Dockerfile pins `PUPPETEER_CACHE_DIR=/app/.cache/puppeteer` in the builder
stage and copies that directory into the production stage so the browser
doesn't need to be re-downloaded (and isn't fetched at container-start time).

`src/scan-pipeline.js` and `src/site-accessibility-report.js` already launch
Chrome with `--no-sandbox --disable-setuid-sandbox`, which is why the
container doesn't need `--cap-add=SYS_ADMIN` or a custom seccomp profile —
the standard (if slightly less isolated) approach for running headless Chrome
in a container. `html-pdf-node`'s own (older, vendored) Puppeteer dependency
for PDF export does the same internally by default.

Neither call site passes `--disable-dev-shm-usage`, so Chrome uses
`/dev/shm` directly; Docker's default 64MB `/dev/shm` is too small for that
and can crash Chrome under load. `docker-compose.yml` sets `shm_size: "1gb"`
on the `app` service as the container-level fix instead of a source change.

### `canvas` (native dependency)

The `canvas` npm package ships a prebuilt binary (`node_modules/canvas/build/Release/canvas.node`)
with all its shared library dependencies (cairo, pango, libjpeg, libgif,
librsvg, …) vendored alongside it in the same directory. No extra Debian
`-dev` packages are needed for it in this image — confirmed via `ldd` against
the shipped binary, which resolves everything from that same directory.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | API listen port **inside** the container. Fixed at `3000` in `docker-compose.yml` — see the hardcoded frontend proxy note above; change `HOST_PORT` instead to publish the API on a different host port. |
| `HOST_PORT` | No | `3000` | Host-side port published for the API (compose-only). |
| `FRONTEND_HOST_PORT` | No | `3001` | Host-side port published for the Next.js frontend (compose-only). |
| `API_TOKEN` | Recommended | *(unset)* | Bearer token API consumers must send to use `/api/scan` and other routes. Part of the in-progress server-hardening work (parallel branch) — wired here so it's already available once that lands. **Set this before exposing the API beyond localhost.** |
| `OPENROUTER_API_KEY` | Optional | *(unset)* | Enables the LLM-powered scanners (`src/scanner-registry.js`). Without it those scanners are simply skipped — not a hard failure. **Server-side only** — never send it to the browser/frontend. |
| `SCAN_ALLOWED_HOSTS` | Recommended | *(unset = unrestricted)* | Comma-separated hostname allowlist for scan targets. Same in-progress hardening work as `API_TOKEN`; without it the API will (currently) attempt to scan whatever URL is submitted, including internal/private hosts (SSRF risk) once combined with the app's own network access. |
| `SCAN_CONCURRENCY` | No | `1` | Concurrent scan jobs (`p-queue`, see `src/server.js`). Each concurrent scan holds a full Chrome instance in memory — size `mem_limit`/host RAM accordingly (roughly 300–500MB of headroom per additional concurrent scan on top of the ~1GB base). |

`API_TOKEN` and `SCAN_ALLOWED_HOSTS` aren't consumed by `src/` yet at the time
of writing (server-hardening work in progress on a parallel branch) — they're
already wired through the container/compose config so no further deployment
changes are needed once that code lands.

## Hosting guidance

Any container host with **≥2GB RAM** per instance works: a plain VPS running
`docker compose up -d`, ECS/Fargate, Cloud Run (set min instances ≥ 1 and a
memory limit ≥ 2GB — Puppeteer's Chrome launch is too slow/heavy for
scale-to-zero cold starts), Fly.io, Railway, Render, etc. Put a reverse proxy
(nginx, Caddy, the platform's own load balancer) in front for TLS — neither
service here terminates TLS itself.

**Not suitable: Vercel or other classic serverless/Lambda-style platforms.**
Puppeteer needs a real, persistent Chrome binary and a writable filesystem
for its cache and `/app/reports`; serverless functions are ephemeral,
size-constrained, and (in most managed serverless products) do not allow
arbitrary native binaries the way a container does. If you specifically need
serverless, that requires swapping to a serverless-Chromium package
(`@sparticuz/chromium` or similar), which is a `src/` code change, not a
deployment config change — out of scope here.

## Security checklist

Before exposing this beyond `localhost`:

- [ ] **Set `API_TOKEN`** to a long random value once the server-hardening
      work that consumes it lands, and require it on every API call.
- [ ] **Set `SCAN_ALLOWED_HOSTS`** to the hostnames you actually intend to
      let people scan. Leaving it unset means the API will submit
      Puppeteer navigation requests to whatever URL a caller supplies.
- [ ] **Keep `OPENROUTER_API_KEY` server-side only** — it's read from
      `process.env` in `src/llm-client.js` and never returned to the
      frontend; don't add it to any client-side/`NEXT_PUBLIC_*` env var.
- [ ] Put TLS termination and, ideally, an additional auth layer (e.g. basic
      auth at the reverse proxy) in front — this app doesn't terminate TLS.
- [ ] Review who can reach `/reports/*` — `src/server.js` serves the reports
      directory as static files with no auth check of its own; the
      in-app rate limiter (5 scans/hour/IP on `/api/scan`) doesn't cover
      that route.
- [ ] `cors()` is enabled with defaults (all origins) in `src/server.js`;
      tighten it at the reverse-proxy layer if you need to restrict callers
      before the equivalent `src/` change lands.

## Volumes and data

`reports/` (HTML/PDF/JSON scan reports, written by `src/report-generator.js`)
is the only stateful directory; it's mounted as the named volume `reports` in
`docker-compose.yml` so reports survive container recreation. Everything
else in the container is rebuilt from the image on every deploy.
