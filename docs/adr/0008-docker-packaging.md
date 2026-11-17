# 0008. Docker packaging

- Status: Accepted
- Date: 2026-11-17
- Area: infra

## Context
The app has the kind of dependencies that break "works on my machine": native modules (`better-sqlite3`, the ONNX
runtime behind the embedding model), a model downloaded from Hugging Face on first run, and a minimum Node version.
Reviewers should be able to run it with one command.

## Decision
`docker compose up --build` starts two containers from one multi-stage `Dockerfile`:

- **api**: Node 22 on Debian slim, production dependencies only, the compiled server, and the embedding model baked in
  at build time (`/models`, `MODEL_CACHE_DIR`). Runs as the non-root `node` user, has a health check, and keeps the
  SQLite database on a named volume (`/data`).
- **web**: nginx serving the built React app and proxying `/api/` to the API, so the browser stays on one origin
  (no CORS) and the API port is not published.

Configuration is passed through `docker-compose.yml` from an optional `.env`; no key is required to start. CI builds the
images and smoke-tests the running stack through the proxy (ingest, index, query, and data surviving a restart).

## Alternatives considered
- **Alpine images**: smaller, but onnxruntime and better-sqlite3 ship glibc prebuilt binaries, so Alpine would force
  compiling from source.
- **Download the model on first start**: smaller image, but needs network at start-up and makes the first run slow and
  fragile; baking it in costs about 90 MB of image size.
- **One container serving both API and static files**: fewer parts, but mixes concerns and loses nginx caching and
  compression for assets.

## Consequences
- Good: one command on any machine with Docker; identical Node, native binaries and model everywhere; offline start.
- Cost / risk: larger image (model included); the stack runs a single API instance (SQLite, in-process queue), so it is a
  packaging of the current design, not horizontal scaling.
- Follow-ups: publish images to a registry from CI; a Postgres + pgvector variant for multi-instance deployments.
