import type { ChunksRepo } from '../db/chunksRepo.js';
import type { ItemsRepo } from '../db/itemsRepo.js';
import { AppError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { Item, ItemSummary } from '../types.js';
import { chunkText } from './chunker.js';
import type { Embedder } from './embedder.js';
import type { JobQueue } from './jobQueue.js';
import type { UrlFetcher } from './urlFetcher.js';
import { assertPublicUrl, parsePublicUrl } from './urlSafety.js';

export type IngestInput = { type: 'note'; content: string; title?: string } | { type: 'url'; url: string; title?: string };

const PREVIEW_CHARS = 200;

export const toSummary = ({ content, ...rest }: Item): ItemSummary => ({
  ...rest,
  preview: content.length > PREVIEW_CHARS ? `${content.slice(0, PREVIEW_CHARS)}…` : content,
});

export class IngestService {
  constructor(
    private readonly items: ItemsRepo,
    private readonly chunks: ChunksRepo,
    private readonly embedder: Embedder,
    private readonly fetcher: UrlFetcher,
    private readonly queue: JobQueue,
    private readonly logger: Logger,
  ) {}

  /**
   * Validates synchronously, stores the item as "processing" and returns immediately.
   * Fetching, chunking and embedding then run on the background queue.
   */
  async ingest(input: IngestInput): Promise<Item> {
    if (input.type === 'note') {
      const title = input.title?.trim() || deriveTitle(input.content);
      const item = this.items.create({ type: 'note', title, content: input.content, status: 'processing' });
      this.queue.enqueue(`index:${item.id}`, () => this.index(item.id));
      return item;
    }

    const url = parsePublicUrl(input.url);
    await assertPublicUrl(url);
    const item = this.items.create({
      type: 'url',
      title: input.title?.trim() || url.hostname,
      sourceUrl: url.toString(),
      status: 'processing',
    });
    this.queue.enqueue(`fetch+index:${item.id}`, async () => {
      try {
        const page = await this.fetcher.fetchPage(url.toString());
        if (!page.text) throw new AppError('UNPROCESSABLE', 'No readable text found at that URL');
        this.items.setContent(item.id, input.title?.trim() || page.title || url.hostname, page.text);
      } catch (err) {
        this.fail(item.id, err);
        return;
      }
      await this.index(item.id);
    });
    return item;
  }

  private async index(itemId: string): Promise<void> {
    const started = Date.now();
    try {
      const item = this.items.get(itemId);
      if (!item) return; // deleted while queued
      const texts = chunkText(item.content);
      if (texts.length === 0) throw new AppError('UNPROCESSABLE', 'Content is empty after cleaning');
      const vectors = await this.embedder.embed(texts);
      this.chunks.replaceForItem(
        itemId,
        this.embedder.id,
        texts.map((text, i) => ({ text, embedding: vectors[i]! })),
      );
      this.items.setStatus(itemId, 'ready');
      this.logger.info({ itemId, chunks: texts.length, ms: Date.now() - started }, 'item indexed');
    } catch (err) {
      this.fail(itemId, err);
    }
  }

  private fail(itemId: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn({ itemId, err }, 'item processing failed');
    this.items.setStatus(itemId, 'failed', message);
  }
}

function deriveTitle(content: string): string {
  const firstLine = content.trim().split('\n')[0] ?? '';
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
}
