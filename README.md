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

## API

| Method & path | Purpose | Success |
|---|---|---|
| `POST /ingest` | `{type:"note",content,title?}` or `{type:"url",url,title?}` | `202 {item}` (indexed in background) |
| `GET /items` | List items (newest first) with `status`: `processing` / `ready` / `failed` | `200 {items}` |
| `GET /items/:id` | One item including full raw content | `200 {item}` |
| `DELETE /items/:id` | Remove item and its vectors | `204` |
| `POST /query` | `{question, topK?=5}` | `200 {answer, sources[], usedFallback}` |
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

## Tradeoffs
See [docs/DESIGN.md](docs/DESIGN.md) for chunking rationale, vector store choice, what breaks at scale, and what I
would change for production.
