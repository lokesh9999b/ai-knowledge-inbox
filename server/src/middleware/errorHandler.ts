import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../errors.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', `Route ${req.method} ${req.path} does not exist`));
};

interface BodyParserError extends Error {
  type?: string;
}

/** Single place that turns any thrown error into the { error: { code, message, details? } } shape. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  let appError: AppError;
  const bodyErr = err as BodyParserError;

  if (err instanceof AppError) {
    appError = err;
  } else if (bodyErr?.type === 'entity.parse.failed') {
    appError = new AppError('VALIDATION_ERROR', 'Request body is not valid JSON');
  } else if (bodyErr?.type === 'entity.too.large') {
    appError = new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large');
  } else {
    req.log.error({ err }, 'unhandled error');
    appError = new AppError('INTERNAL_ERROR', 'Something went wrong on the server');
  }

  if (appError.status < 500) req.log.warn({ code: appError.code, message: appError.message }, 'request rejected');
  const retryAfter = (appError.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
  if (appError.code === 'RATE_LIMITED' && retryAfter) res.setHeader('Retry-After', String(retryAfter));
  res.status(appError.status).json({
    error: { code: appError.code, message: appError.message, details: appError.details },
  });
};
