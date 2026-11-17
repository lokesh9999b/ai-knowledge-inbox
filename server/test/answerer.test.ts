import { describe, expect, it } from 'vitest';
import { buildContext, normaliseCitations } from '../src/services/answerer.js';

describe('normaliseCitations', () => {
  it('converts full-width brackets to [n]', () => {
    expect(normaliseCitations('Pods share storage【1】 and network【2】.')).toBe('Pods share storage[1] and network[2].');
  });

  it('leaves normal citations untouched', () => {
    expect(normaliseCitations('Already fine [1].')).toBe('Already fine [1].');
  });
});

describe('buildContext', () => {
  it('numbers passages from 1 and includes title and url', () => {
    const context = buildContext([
      { itemId: 'a', chunkId: 'c1', title: 'Doc', sourceUrl: 'https://x.test', snippet: 'First', score: 0.9 },
      { itemId: 'b', chunkId: 'c2', title: 'Note', sourceUrl: null, snippet: 'Second', score: 0.8 },
    ]);
    expect(context).toBe('[1] (Doc, https://x.test)\nFirst\n\n[2] (Note)\nSecond');
  });
});
