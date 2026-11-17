# Architecture decision records

One short file per decision that is expensive to reverse. Format follows [0000-template.md](0000-template.md).

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-sqlite-brute-force-vector-search.md) | SQLite storage with brute-force cosine search | Accepted |
| [0002](0002-async-ingest-with-in-process-queue.md) | Async ingest with an in-process serial queue | Accepted |
| [0003](0003-local-embeddings-groq-for-answers.md) | Local embeddings, Groq for answers | Accepted |
| [0004](0004-sentence-aware-chunking.md) | Sentence-aware chunking, ~800 chars, ~120 overlap | Accepted |
| [0005](0005-ssrf-guarded-url-fetch.md) | SSRF-guarded server-side URL fetch | Accepted |
