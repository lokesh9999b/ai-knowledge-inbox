# 0002. Async ingest with an in-process serial queue

- Status: Accepted
- Date: 2026-11-17
- Area: backend

## Context
Fetching a page and embedding chunks takes seconds; users should not wait on a request, and a slow site must not
tie up the API.

## Decision
`POST /ingest` validates, stores the item as `processing`, returns `202`, and enqueues a job on an in-memory FIFO
queue that runs one job at a time. The UI polls `GET /items` while anything is `processing`. Failures set
`status=failed` with a readable reason. On startup, leftover `processing` rows are marked `failed`.

## Alternatives considered
- **Do the work inside the request**: simple, but slow requests and timeouts on large pages.
- **BullMQ/Redis or a DB-backed queue**: durable, but adds infrastructure for one user.
- **Parallel jobs**: embedding is CPU-bound in one process, so parallelism buys little.

## Consequences
- Good: fast accept (837 rps measured, 1000 notes accepted in 1.3 s), reads stay responsive during indexing.
- Cost / risk: jobs are lost on restart (visible as `failed`); no retries. Embedding runs in a worker thread
  ([ADR 0006](0006-embedding-in-a-worker-thread.md)), so indexing no longer stalls the API.
- Follow-ups: durable queue plus separate workers; polling to SSE.
