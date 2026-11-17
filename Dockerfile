# syntax=docker/dockerfile:1
#
# One image per service, built from the repo root:
#   target "api"  -> Node API (Express + SQLite + embedding worker), the embedding model baked in
#   target "web"  -> nginx serving the built React app and proxying /api to the API
# Debian (glibc) rather than Alpine on purpose: onnxruntime ships prebuilt glibc binaries.
# better-sqlite3 is compiled from source at install time, so the build stages carry a C++ toolchain and the
# runtime stage does not (it only receives the compiled node_modules).

ARG NODE_IMAGE=node:22-bookworm-slim

# ---- toolchain: node + the compiler needed to build native modules ----
FROM ${NODE_IMAGE} AS toolchain
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/

# ---- build: install everything, compile the server (tsc) and the web app (vite) ----
FROM toolchain AS build
RUN npm ci
COPY server server
COPY web web
RUN npm run build

# ---- deps: production dependencies of the server only, plus the baked-in embedding model ----
FROM toolchain AS deps
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY server/scripts/download-model.mjs server/scripts/
RUN cd server && node scripts/download-model.mjs /models

# ---- api: clean runtime (no compiler), compiled server, production node_modules, model ----
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/data/inbox.db \
    MODEL_CACHE_DIR=/models
WORKDIR /app
COPY --from=deps /app/package.json /app/package-lock.json ./
COPY --from=deps /app/node_modules node_modules
# server/ carries its own non-hoisted node_modules (e.g. a newer pino and zod than the root copies).
COPY --from=deps /app/server server
COPY --from=deps /models /models
COPY --from=build /app/server/dist server/dist
RUN mkdir -p /data && chown -R node:node /data /models
USER node
VOLUME /data
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]

# ---- web: static files behind nginx ----
FROM nginx:1.27-alpine AS web
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
