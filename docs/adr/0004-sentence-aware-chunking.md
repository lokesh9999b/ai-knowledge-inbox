# 0004. Sentence-aware chunking, ~800 chars, ~120 overlap

- Status: Accepted
- Date: 2026-11-17
- Area: backend

## Context
Retrieval quality and citation readability both depend on how text is split.

## Decision
Split on paragraph and sentence boundaries, pack greedily to 800 characters, carry the trailing sentences (up to 120
characters) into the next chunk. A single over-long sentence falls back to word-level then character-level splitting.

## Alternatives considered
- **Fixed-size character windows**: cut sentences in half, which hurts embeddings and makes snippets unreadable.
- **Structural chunking by HTML headings**: better for long articles, more complex; deferred.

## Consequences
- Good: coherent chunks, readable citations, within the model's 256-token input limit, boundary facts survive overlap.
- Cost / risk: slightly more chunks; structure-blind.
- Follow-ups: parent-child retrieval and heading-aware splitting for long documents.
