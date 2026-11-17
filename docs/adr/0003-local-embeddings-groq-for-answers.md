# 0003. Local embeddings, Groq for answers

- Status: Accepted
- Date: 2026-11-17
- Area: backend

## Context
Embeddings and a chat LLM are both needed. The chosen LLM provider (Groq) has no embeddings API.

## Decision
Embed locally with all-MiniLM-L6-v2 (384-d) through transformers.js. Generate answers with Groq through its
OpenAI-compatible API (default `openai/gpt-oss-120b`, configurable). Without a key the app returns an extractive
answer and flags `usedFallback`. A deterministic hashing embedder exists for tests and offline use.

## Alternatives considered
- **OpenAI embeddings**: good quality, but a second vendor, key and per-token cost.
- **Hosted embeddings from a third provider**: same objection.

## Consequences
- Good: no second API key, private content is not sent out for indexing, free, deterministic in tests.
- Cost / risk: ~25 MB model download on first run; embedding competes with request handling on the same CPU;
  models served by Groq change (the original default model was retired, hence the env var).
- Follow-ups: embedding worker; evaluate larger embedding models against a labelled question set.
