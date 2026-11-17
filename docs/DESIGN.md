# Design notes & tradeoffs

## Pipeline

```
POST /ingest ─► validate ─► store item (status=processing) ─► 202
                                   │
                          background JobQueue (serial)
                                   │  (URL only: SSRF-checked fetch → readable text)
                            chunk ─► embed (local MiniLM) ─► store vectors in SQLite ─► status=ready | failed

POST /query ─► validate ─► embed question ─► cosine top-k ─► (none above threshold? say so, skip LLM)
                                                          └► Groq LLM with numbered context ─► answer + sources
```

## Chunking approach
Sentence-aware sliding window: split on paragraph/sentence boundaries, pack greedily to **~800 characters**
(~200 tokens), carry **~120 characters of overlap** (whole trailing sentences) into the next chunk.

- **Why not fixed-size character windows?** They cut sentences in half, which hurts embedding quality and makes
  citation snippets unreadable.
- **Why ~800 chars?** Small enough that one chunk is about one idea (sharper retrieval, cheaper prompts), large
  enough to keep context. It is also well inside MiniLM's 256-token input limit, so nothing is silently truncated.
- **Why overlap?** Facts that straddle a boundary remain retrievable from either side.
- A single over-long "sentence" (minified text, code, tables) falls back to word-level, then character-level splitting.
- Not done (deliberately): semantic/structural chunking by HTML headings, parent-child retrieval. Worth it once
  documents are long and structured.

## Vector store choice
**SQLite (better-sqlite3) with embeddings as float32 BLOBs, brute-force cosine in Node.** Vectors are L2-normalised
so cosine is a dot product.

- Zero infrastructure, one file, transactional with the item metadata (delete cascades to chunks), survives restarts.
- Exact search, no recall tuning. For a single-user inbox (≲ 50k chunks) a full scan is single-digit milliseconds
  to low tens of ms.
- Each chunk stores the `embedder` id; search only compares vectors from the same model, so switching models
  never produces garbage scores (old items simply need re-adding).

**Embeddings:** local `all-MiniLM-L6-v2` (384-d) via transformers.js. Groq has no embeddings API, and a local model
means no second vendor/key, no per-token cost, and private content never leaves the machine for indexing.
A deterministic hashing embedder (`EMBEDDER=hash`) exists for tests/offline use; it is lexical only.

**LLM:** Groq (`llama-3.3-70b-versatile`) through its OpenAI-compatible API. The prompt restricts the model to the
numbered passages and asks for `[n]` citations; the API returns those same passages as `sources` in the same order.
Without `GROQ_API_KEY` the app degrades to an extractive answer (best passage) and says so in the response.

**Relevance threshold:** chunks below a per-embedder cosine floor are dropped. If nothing qualifies the LLM is not
called at all, which avoids hallucinated answers and saves a request.

## What breaks at scale
| Area | Problem | Fix |
|---|---|---|
| Search | O(n) scan and all vectors loaded per query; memory/latency grow linearly | ANN index: pgvector (HNSW), Qdrant, or sqlite-vec; cache vectors in memory |
| Ingest | In-process queue loses jobs on restart; embedding is CPU-bound on the API process | Durable queue (BullMQ/SQS/Postgres `SKIP LOCKED`) + separate embedding workers |
| Storage | Single SQLite writer, single node | Postgres; object storage for raw pages |
| Multi-user | No auth/tenancy; one global inbox | Auth, `user_id` on every row and every query filter |
| URL fetching | SSRF check has a DNS-rebinding race (resolve vs connect); no robots.txt, no JS rendering, no PDFs | Pin the resolved IP when connecting / egress proxy; headless render service; PDF parser |
| Retrieval quality | Pure dense retrieval, fixed top-k, no reranker | Hybrid BM25 + vector, cross-encoder reranking, MMR for diversity |
| Cost / abuse | Per-IP rate limit only | Per-user quotas, response caching, request budgets |

## What I'd change for production
1. Postgres + pgvector, migrations (not `CREATE IF NOT EXISTS`), connection pooling.
2. Durable job queue with retries/backoff, idempotent indexing, and an explicit re-index path when the embedding model changes.
3. Auth (OIDC), per-user data isolation, quotas.
4. Observability: request IDs are already logged (pino); add metrics (queue depth, retrieval latency, LLM latency/tokens), tracing, alerts.
5. Retrieval evals: a small labelled question set to track recall@k and answer faithfulness when changing chunking/models.
6. Streaming answers (SSE), prompt-injection hardening for fetched pages (content is treated as data, but a stricter policy and output filtering would be added), and content-type support for PDF/Markdown.
7. Containerised deploy behind a reverse proxy with TLS, secrets from a manager, health/readiness probes (`/health` exists).

## API conventions
- `POST /ingest` → `202 { item }` (accepted; processing is asynchronous, poll `GET /items`).
- `GET /items` → `200 { items[] }`, newest first; `GET /items/:id`, `DELETE /items/:id` (`204`).
- `POST /query` → `200 { answer, sources[], usedFallback }`.
- Errors are always `{ error: { code, message, details? } }`: `400` validation, `404`, `413`, `422` (well-formed but
  unprocessable, e.g. private URL), `429`, `502` (LLM/remote fetch failed), `500`.
- Every response carries `x-request-id`, which also appears in the structured logs.
