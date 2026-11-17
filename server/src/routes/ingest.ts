import { Router } from 'express';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { toSummary, type IngestService } from '../services/ingestService.js';
import { ingestSchema } from './schemas.js';

export function ingestRouter(ingest: IngestService): Router {
  const router = Router();
  // 202: the item is accepted and stored; chunking/embedding finish in the background.
  router.post(
    '/ingest',
    validateBody(ingestSchema),
    asyncHandler(async (req, res) => {
      const item = await ingest.ingest(req.body);
      res.status(202).json({ item: toSummary(item) });
    }),
  );
  return router;
}
