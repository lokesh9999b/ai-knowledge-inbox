# 0006. Embedding in a worker thread

- Status: Accepted
- Date: 2026-11-17
- Area: backend

## Context
The local embedding model ran on the main thread. Each inference is CPU-bound, so while queries or indexing were
embedding, the HTTP event loop stalled: `/health` took 631 ms at p95 under query load, and queries queued behind each
other (p99 of 2.8 s at 200 concurrent).

## Decision
Run the model in a worker thread (`WorkerEmbedder`, `server/src/services/workerEmbedder.ts`). The main thread sends
`{ id, texts }` and gets back transferred `Float32Array`s. Requests go to the least busy worker, a crashed worker fails
its in-flight requests and is replaced on the next call, and `close()` terminates workers during graceful shutdown.
`EMBED_WORKERS` sets the pool size; the default is **1**, and 0 keeps the model on the main thread.

## Alternatives considered
- **Keep it on the main thread**: simplest, but stalls the event loop (measured above).
- **Two or more workers**: measured worse. At 1400 chunks one worker gave 240 queries/s; two gave 135, because the model
  already uses every core and a second worker only oversubscribes the CPU.
- **A separate embedding service**: the right shape for several instances, but more infrastructure than one user needs.

## Consequences
- Good: `/health` p95 under load fell from 631 ms to 34 ms; query p99 at 200 concurrent fell from 2.78 s to 1.03 s;
  throughput rose from 189 to 240 queries/s; the model loads at start-up instead of on the first request.
- Cost / risk: one more moving part (message protocol, worker lifecycle); the worker file must be resolvable both from
  TypeScript source (tests, `tsx`) and from the compiled `dist`.
- Follow-ups: a separate embedding service when running several API instances.
