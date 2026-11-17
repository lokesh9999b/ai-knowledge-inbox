# 0007. LLM fallback chain with timeouts and a circuit breaker

- Status: Accepted
- Date: 2026-11-17
- Area: backend

## Context
Answers depended on one Groq model. Measured behaviour: p50 about 600 ms, but a burst of 50 requests at concurrency 8
had 33 rate limited (429), the default backup model later showed a 1000 requests/day cap, and a broken model name or key
fails every request. Before this change any of those became an error (`429`/`502`) even though the retrieved passages
were already in hand.

## Decision
`/query` never fails because the LLM side is slow or down. `ChainAnswerer` tries providers in order and falls through on
any failure (timeout, 429, 5xx, bad key, empty answer):

1. Groq primary model (`GROQ_MODEL`)
2. Groq backup model (`GROQ_FALLBACK_MODEL`; limits are per model, so this absorbs a primary 429)
3. Optional extra OpenAI-compatible provider (`FALLBACK_LLM_BASE_URL`, `_API_KEY`, `_MODEL`), e.g. Hugging Face's
   inference router
4. Extractive answer: quotes the best retrieved passage. It needs no network and cannot fail.

Bounds on waiting: each attempt has its own timeout (`LLM_TIMEOUT_MS`, default 6 s) and the whole chain shares one
deadline (`LLM_DEADLINE_MS`, default 10 s) enforced with an `AbortSignal`, so total wait is capped no matter how many
providers are configured. A per-provider circuit breaker (3 consecutive failures, 30 s cooldown, one trial afterwards)
skips a provider that keeps failing, so a dead provider does not cost every request its full timeout.

The response says what happened: `answeredBy` (`groq:...`, `fallback:...`, `extractive`) and, when degraded, a
user-facing `notice` that the UI shows.

## Alternatives considered
- **Return 502/429 and let the client retry**: honest but unhelpful; the answer material is already retrieved.
- **Local generative model (transformers.js) as the fallback**: needs no key, but a large download and slow CPU
  inference, and answer quality would be poor; the extractive answer is a better last resort for this app.
- **Only per-attempt timeouts**: the worst case is the sum of all timeouts, hence the shared deadline.

## Consequences
- Good: verified against the real API: a broken primary falls over to the backup (first request 1.8 s), a bad key or
  timeout gives a 200 with an explanation, and once the breaker trips requests answer in about 60 ms instead of waiting.
- Cost / risk: a degraded answer is a quoted passage, not a synthesised answer, and the client must read `notice`;
  an LLM outage no longer shows up as HTTP errors, so monitor the `LLM provider failed` log lines and `answeredBy`.
- Follow-ups: metrics on `answeredBy`; response cache for repeated questions; cap concurrent LLM calls.
