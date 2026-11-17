import { Router } from 'express';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import type { QueryService } from '../services/queryService.js';
import { querySchema, type QueryBody } from './schemas.js';

export function queryRouter(query: QueryService): Router {
  const router = Router();
  router.post(
    '/query',
    validateBody(querySchema),
    asyncHandler(async (req, res) => {
      const { question, topK } = req.body as QueryBody;
      res.json(await query.ask(question, topK));
    }),
  );
  return router;
}
