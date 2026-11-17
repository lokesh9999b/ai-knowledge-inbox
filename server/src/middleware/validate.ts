import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../errors.js';

/** Validates req.body against a zod schema and replaces it with the parsed (typed, trimmed) value. */
export const validateBody =
  (schema: ZodTypeAny): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.') || 'body', message: i.message }));
      const summary = details.map((d) => `${d.field}: ${d.message}`).join('; ');
      return next(new AppError('VALIDATION_ERROR', `Invalid request: ${summary}`, details));
    }
    req.body = result.data;
    next();
  };

/** Express 4 does not catch rejected promises; this forwards them to the error handler. */
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
