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

/** Same as validateBody, for the query string (values arrive as strings, so schemas use z.coerce). */
export const validateQuery =
  (schema: ZodTypeAny): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.') || 'query', message: i.message }));
      const summary = details.map((d) => `${d.field}: ${d.message}`).join('; ');
      return next(new AppError('VALIDATION_ERROR', `Invalid request: ${summary}`, details));
    }
    // Replace the raw strings with the parsed (coerced, defaulted) values.
    Object.assign(req.query, result.data);
    next();
  };

/** Express 4 does not catch rejected promises; this forwards them to the error handler. */
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
