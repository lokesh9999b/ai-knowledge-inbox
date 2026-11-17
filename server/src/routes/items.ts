import { Router } from 'express';
import type { ItemsRepo } from '../db/itemsRepo.js';
import { AppError } from '../errors.js';
import { validateQuery } from '../middleware/validate.js';
import { toSummary } from '../services/ingestService.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { listItemsSchema, type ListItemsQuery } from './schemas.js';

export function itemsRouter(items: ItemsRepo): Router {
  const router = Router();

  // Keyset pagination: fetch limit+1 rows to learn whether another page exists without a second query.
  router.get('/items', validateQuery(listItemsSchema), (req, res) => {
    const { limit, cursor, status } = req.query as unknown as ListItemsQuery;
    const rows = items.list({ limit: limit + 1, after: cursor ? decodeCursor(cursor) : undefined, status });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    res.json({
      items: page.map(toSummary),
      nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      total: items.count(status),
    });
  });

  router.get('/items/:id', (req, res) => {
    const item = items.get(req.params.id);
    if (!item) throw new AppError('NOT_FOUND', `Item ${req.params.id} not found`);
    res.json({ item: { ...toSummary(item), content: item.content } }); // summary fields plus the full raw content
  });

  router.delete('/items/:id', (req, res) => {
    if (!items.delete(req.params.id)) throw new AppError('NOT_FOUND', `Item ${req.params.id} not found`);
    res.status(204).end();
  });

  return router;
}
