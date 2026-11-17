# 0001. SQLite storage with brute-force cosine search

- Status: Accepted
- Date: 2026-11-17
- Area: backend

## Context
The assignment allows in-memory, SQLite or a lightweight DB for vectors. Single user, thousands of chunks, must run
locally with one command.

## Decision
Store items and chunk vectors (float32 BLOB, L2-normalised) in SQLite via better-sqlite3. Search by loading candidate
vectors and computing dot products (= cosine) in Node. The `embedder` id is stored per chunk and search only compares
vectors from the same model.

## Alternatives considered
- **pgvector / Qdrant / Chroma**: right at scale, but needs a server, which fails the "run locally" goal and is
  over-engineering for one user.
- **Pure in-memory**: loses data on restart.
- **sqlite-vec extension**: nice, but a native extension adds install risk for reviewers.

## Consequences
- Good: zero infrastructure, exact results, transactional with metadata, cascade delete.
- Cost / risk: O(n) per query. Measured: 134 rps at 400 chunks falling to 77 rps at 1400 (see
  [system design](../architecture/system-design.md#5-capacity-can-it-handle-1000-requests)).
- Follow-ups: cache the vector matrix in memory; move to pgvector (HNSW) when multi-user.
