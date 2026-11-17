# AI Knowledge Inbox

[![CI](https://github.com/lokesh9999b/ai-knowledge-inbox/actions/workflows/ci.yml/badge.svg)](https://github.com/lokesh9999b/ai-knowledge-inbox/actions/workflows/ci.yml)

Save short notes and URLs, then ask questions over them. Answers come from a small RAG pipeline and cite the
exact saved passages they were based on.

**Stack:** Node + Express + TypeScript, SQLite (better-sqlite3), local MiniLM embeddings (transformers.js),
Groq LLM (OpenAI-compatible API), React 18 + Vite + Tailwind.

> **AI assistance disclosure:** This project was built with AI assistance (Claude Code). The commit history
> reflects that via `Co-Authored-By` trailers. See [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md) for a guided tour of the code.

## Quick start

Requires Node 20+.

```bash
npm install
cp .env.example .env      # add GROQ_API_KEY (free at https://console.groq.com) for LLM answers
npm run dev               # API on :3001, UI on http://localhost:5173
```

- Without `GROQ_API_KEY` everything works, but answers are extractive (the best matching passage is quoted).
- The first ingest downloads the ~25 MB embedding model (cached afterwards). Set `EMBEDDER=hash` to skip it
  (offline, lexical-only matching).

Other scripts: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.

### If the LLM is slow or down

Questions still get answered. The app tries Groq's primary model, then a Groq backup model (`GROQ_FALLBACK_MODEL`),
then an optional extra provider, and finally quotes the best matching saved passage (no network needed). Each attempt
times out after `LLM_TIMEOUT_MS` (6 s) and the whole step is capped at `LLM_DEADLINE_MS` (10 s). The response includes
`answeredBy` and a `notice` explaining any degraded answer, which the UI shows.

Optional extra provider, any OpenAI-compatible API, for example Hugging Face's inference router (set all three):

```
FALLBACK_LLM_BASE_URL=https://router.huggingface.co/v1
FALLBACK_LLM_API_KEY=<your Hugging Face token>
FALLBACK_LLM_MODEL=<a chat model your account can call>
```

(Hugging Face is otherwise only used to download the local embedding model; nothing is sent to it for answers unless you
configure this.)

Tuning (all optional, see `.env.example`): `EMBED_WORKERS` (worker threads for the embedding model, default 1, 0 = main
thread), `RATE_LIMIT_PER_MINUTE` (per-IP limit on `/ingest` and `/query`, default 60).

Load test (see [system design](docs/architecture/system-design.md#5-capacity-can-it-handle-1000-requests)): run the server with
`RATE_LIMIT_PER_MINUTE=0`, then e.g.
`node scripts/load-test.mjs "query" POST /query 1000 50 '{"question":"what is espresso"}'`.

## API

| Method & path | Purpose | Success |
|---|---|---|
| `POST /ingest` | `{type:"note",content,title?}` or `{type:"url",url,title?}` | `202 {item}` (indexed in background) |
| `GET /items` | Newest first, paginated: `?limit=50&cursor=...&status=processing` (or `ready`, `failed`) | `200 {items, nextCursor, total}` |
| `GET /items/:id` | One item including full raw content | `200 {item}` |
| `DELETE /items/:id` | Remove item and its vectors | `204` |
| `POST /query` | `{question, topK?=5}` | `200 {answer, sources[], usedFallback, answeredBy, notice?}`; falls back to a backup model or an extractive answer when the LLM is slow or down |
| `GET /health` | Liveness | `200` |

Errors: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }` with 400/404/413/422/429/502/500.

```bash
curl -X POST localhost:3001/ingest -H 'content-type: application/json' \
  -d '{"type":"note","content":"Espresso is brewed at about 9 bars of pressure."}'

curl -X POST localhost:3001/query -H 'content-type: application/json' \
  -d '{"question":"What pressure does espresso need?"}'
```

`sources[]` entries: `{ itemId, chunkId, title, sourceUrl, snippet, score }`, in the same order as the `[n]`
citations in the answer.

## Project layout

```
server/src
  config.ts  logger.ts  errors.ts  container.ts  app.ts  index.ts
  db/          SQLite connection, schema.sql, items/chunks repositories
  services/    chunker, embedder, urlSafety (SSRF), urlFetcher, vectorSearch,
               answerer (Groq / extractive), jobQueue, ingestService, queryService
  routes/      ingest, items, query + zod schemas
  middleware/  validation, error handler
web/src
  api/         typed fetch client      hooks/   useItems (polling), useAsk
  components/  AddItemForm, ItemList, AskPanel, AnswerCard, ErrorBanner
docs/DESIGN.md   chunking rationale, vector store choice, scaling limits, production changes
```

Routes are thin; business logic lives in services; `container.ts` is the single composition root, so tests swap in
fake embedders, LLMs and fetchers without mocking modules.

## Debuggability
Structured JSON logs (pino) with a request id per request (`x-request-id` header echoed back), logs for each indexing
job (chunks, ms) and each query (sources, ms, fallback), consistent error codes, and failed items store a
human-readable reason shown in the UI.

## Documentation
- [System design](docs/architecture/system-design.md): component and sequence diagrams, measured capacity (1000+ requests), scaling path
- [ADRs](docs/adr/README.md): one short record per key decision
- [API contract](contract/openapi.json): OpenAPI for every endpoint
- [Code walkthrough](docs/WALKTHROUGH.md)

## Tradeoffs
See [docs/DESIGN.md](docs/DESIGN.md) for chunking rationale, vector store choice, what breaks at scale, and what I
would change for production.
