import type { Logger } from '../logger.js';

export interface Embedder {
  /** Stable identifier stored with each vector; vectors are only compared within one id. */
  readonly id: string;
  /** Cosine similarity below this is treated as "not relevant". */
  readonly minScore: number;
  /** Returns L2-normalised vectors, one per input text. */
  embed(texts: string[]): Promise<Float32Array[]>;
  /** Starts loading any model/workers in the background so the first request does not pay for it. */
  warmUp?(): void;
  /** Releases workers/native resources. Call before the process exits. */
  close?(): Promise<void>;
}

export type EmbedderKind = 'local' | 'hash';

/** Identity of each embedder, shared by the in-process and worker-thread implementations. */
export const EMBEDDER_META: Record<EmbedderKind, { id: string; minScore: number }> = {
  local: { id: 'minilm-l6-v2-384', minScore: 0.2 },
  hash: { id: 'hash-v1-384', minScore: 0.08 },
};

const normalise = (v: Float32Array): Float32Array => {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
};

const tokenize = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** FNV-1a 32-bit hash. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic bag-of-words "hashing trick" embedder. Lexical only (no synonyms), but needs no
 * model download or network, so it is used in tests and as an offline fallback.
 */
export class HashEmbedder implements Embedder {
  readonly id = EMBEDDER_META.hash.id;
  readonly minScore = EMBEDDER_META.hash.minScore;
  private readonly dim = 384;

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const v = new Float32Array(this.dim);
      const tokens = tokenize(text);
      for (const token of tokens) {
        const h = fnv1a(token);
        v[h % this.dim]! += h & 0x80000000 ? -1 : 1;
      }
      // Bigrams add a little word-order signal.
      for (let i = 0; i + 1 < tokens.length; i++) {
        const h = fnv1a(`${tokens[i]} ${tokens[i + 1]}`);
        v[h % this.dim]! += (h & 0x80000000 ? -1 : 1) * 0.5;
      }
      return normalise(v);
    });
  }
}

type FeatureExtractor = (
  input: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

/** all-MiniLM-L6-v2 (384-d) running in-process via transformers.js. No API key required. */
export class LocalEmbedder implements Embedder {
  readonly id = EMBEDDER_META.local.id;
  readonly minScore = EMBEDDER_META.local.minScore;
  private extractor?: Promise<FeatureExtractor>;

  constructor(
    private readonly logger: Pick<Logger, 'info'>,
    /** Where model files are cached. The Docker image bakes the model in here so first start needs no download. */
    private readonly cacheDir?: string,
  ) {}

  private load(): Promise<FeatureExtractor> {
    this.extractor ??= (async () => {
      this.logger.info('loading local embedding model (first run downloads ~25MB unless already cached)');
      const { pipeline, env } = await import('@huggingface/transformers');
      if (this.cacheDir) env.cacheDir = this.cacheDir;
      const extractor = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')) as unknown as FeatureExtractor;
      this.logger.info('local embedding model ready');
      return extractor;
    })().catch((err) => {
      this.extractor = undefined; // allow retry on next call
      throw err;
    });
    return this.extractor;
  }

  warmUp(): void {
    this.load().catch(() => undefined); // errors surface on the first real embed()
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.load();
    const out: Float32Array[] = [];
    const batchSize = 16;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const result = await extractor(batch, { pooling: 'mean', normalize: true });
      const dim = result.dims[1]!;
      batch.forEach((_, j) => out.push(result.data.slice(j * dim, (j + 1) * dim)));
    }
    return out;
  }
}
