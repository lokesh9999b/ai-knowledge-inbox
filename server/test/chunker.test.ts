import { describe, expect, it } from 'vitest';
import { chunkText } from '../src/services/chunker.js';

const opts = { maxChars: 100, overlapChars: 30 };

describe('chunkText', () => {
  it('returns nothing for blank input', () => {
    expect(chunkText('  \n\n ')).toEqual([]);
  });

  it('keeps short text as one chunk', () => {
    expect(chunkText('Hello world. This is short.')).toEqual(['Hello world. This is short.']);
  });

  it('never exceeds maxChars and covers all sentences', () => {
    const sentences = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} says something.`);
    const chunks = chunkText(sentences.join(' '), opts);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(opts.maxChars);
    for (const s of sentences) expect(chunks.some((c) => c.includes(s))).toBe(true);
  });

  it('overlaps consecutive chunks so boundary facts survive', () => {
    const text = 'Alpha is first. Beta is second. Gamma is third. Delta is fourth. Epsilon is fifth.';
    const chunks = chunkText(text, { maxChars: 50, overlapChars: 20 });
    for (let i = 1; i < chunks.length; i++) {
      const prevSentences = chunks[i - 1]!.split(/(?<=\.)\s/);
      expect(chunks[i]!.startsWith(prevSentences[prevSentences.length - 1]!)).toBe(true);
    }
  });

  it('hard-splits a single oversized token run', () => {
    const chunks = chunkText('x'.repeat(250), opts);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= opts.maxChars)).toBe(true);
  });

  it('makes progress on pathological input (terminates)', () => {
    const chunks = chunkText('a. '.repeat(500), opts);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
