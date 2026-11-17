import { Router } from 'express';
import type { ItemsRepo } from '../db/itemsRepo.js';
import { AppError } from '../errors.js';
import { toSummary } from '../services/ingestService.js';

export function itemsRouter(items: ItemsRepo): Router {
  const router = Router();

  router.get('/items', (_req, res) => {
    res.json({ items: items.list().map(toSummary) });
  });

  router.get('/items/:id', (req, res) => {
    const item = items.get(req.params.id);
    if (!item) throw new AppError('NOT_FOUND', `Item ${req.params.id} not found`);
    res.json({ item }); // includes the full raw content
  });

  router.delete('/items/:id', (req, res) => {
    if (!items.delete(req.params.id)) throw new AppError('NOT_FOUND', `Item ${req.params.id} not found`);
    res.status(204).end();
  });

  return router;
}
