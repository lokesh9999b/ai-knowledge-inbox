export interface ChunkOptions {
  maxChars: number;
  overlapChars: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxChars: 800, overlapChars: 120 };

/**
 * Sentence-aware sliding-window chunker.
 *
 * 1. Split text into sentence-sized units (paragraph breaks are also boundaries).
 * 2. Pack units greedily up to `maxChars`.
 * 3. Start each new chunk with the trailing units of the previous one (<= `overlapChars`)
 *    so facts that straddle a boundary stay retrievable.
 *
 * Chunks end on sentence boundaries where possible, which keeps embeddings semantically
 * coherent and makes snippets readable as citations.
 */
export function chunkText(text: string, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): string[] {
  const { maxChars, overlapChars } = options;
  const units = splitIntoUnits(text, maxChars);
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;

  const flush = () => {
    if (current.length) chunks.push(current.join(' '));
  };

  for (const unit of units) {
    if (length + unit.length + 1 > maxChars && current.length) {
      flush();
      current = overlapTail(current, overlapChars);
      length = joinedLength(current);
    }
    current.push(unit);
    length = joinedLength(current);
  }
  flush();
  return chunks;
}

const joinedLength = (parts: string[]): number => parts.reduce((n, p) => n + p.length + 1, 0);

function overlapTail(units: string[], overlapChars: number): string[] {
  const tail: string[] = [];
  let size = 0;
  for (let i = units.length - 1; i > 0; i--) {
    // never carry the whole previous chunk (i > 0) so progress is guaranteed
    const unit = units[i]!;
    if (size + unit.length + 1 > overlapChars) break;
    tail.unshift(unit);
    size += unit.length + 1;
  }
  return tail;
}

function splitIntoUnits(text: string, maxChars: number): string[] {
  const units: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const clean = paragraph.replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
      units.push(...hardSplit(sentence, maxChars));
    }
  }
  return units;
}

/** Fallback for a single "sentence" longer than a chunk: split on words. */
function hardSplit(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) return [sentence];
  const parts: string[] = [];
  let buffer = '';
  for (const word of sentence.split(' ')) {
    if (word.length > maxChars) {
      if (buffer) parts.push(buffer);
      buffer = '';
      for (let i = 0; i < word.length; i += maxChars) parts.push(word.slice(i, i + maxChars));
      continue;
    }
    if (buffer.length + word.length + 1 > maxChars) {
      parts.push(buffer);
      buffer = word;
    } else {
      buffer = buffer ? `${buffer} ${word}` : word;
    }
  }
  if (buffer) parts.push(buffer);
  return parts;
}
