import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { toLlmError } from '../src/services/answerer.js';
import { setup } from './helpers.js';

describe('toLlmError', () => {
  it('maps a provider 429 to RATE_LIMITED using the Retry-After header (plain object headers)', () => {
    const err = toLlmError({ status: 429, message: 'Rate limit reached', headers: { 'retry-after': '7' } });
    expect(err).toMatchObject({ code: 'RATE_LIMITED', status: 429, details: { retryAfterSeconds: 7 } });
    expect(err.message).toMatch(/rate limited.*7s/);
  });

  it('reads Retry-After from a Headers instance and rounds up fractions', () => {
    const err = toLlmError({ status: 429, headers: new Headers({ 'retry-after': '2.2' }) });
    expect(err.details).toEqual({ retryAfterSeconds: 3 });
  });

  it('falls back to a default wait when Retry-After is missing or invalid', () => {
    expect(toLlmError({ status: 429 }).details).toEqual({ retryAfterSeconds: 10 });
    expect(toLlmError({ status: 429, headers: { 'retry-after': 'soon' } }).details).toEqual({ retryAfterSeconds: 10 });
  });

  it('maps every other failure to UPSTREAM_ERROR (502) and keeps the cause in the message', () => {
    expect(toLlmError({ status: 404, message: 'model not found' })).toMatchObject({
      code: 'UPSTREAM_ERROR',
      status: 502,
      message: 'The language model request failed: model not found',
    });
    expect(toLlmError(new Error('socket hang up')).message).toMatch(/socket hang up/);
    expect(toLlmError(undefined).code).toBe('UPSTREAM_ERROR');
  });
});

describe('POST /query when the provider is rate limited', () => {
  it('returns 429 with a Retry-After header and a readable message', async () => {
    const { app, deps } = setup({
      answerer: {
        answer: async () => {
          throw new AppError('RATE_LIMITED', 'The language model is rate limited right now. Retry in about 7s.', {
            retryAfterSeconds: 7,
          });
        },
      },
    });
    await request(app).post('/ingest').send({ type: 'note', content: 'Espresso is strong coffee.' });
    await deps.queue.idle();

    const res = await request(app).post('/query').send({ question: 'what is espresso' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('7');
    expect(res.body.error).toMatchObject({ code: 'RATE_LIMITED' });
    expect(res.body.error.message).toMatch(/Retry in about 7s/);
  });
});
