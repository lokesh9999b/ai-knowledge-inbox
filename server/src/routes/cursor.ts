import { AppError } from '../errors.js';

export interface Cursor {
  createdAt: string;
  id: string;
}

/** Opaque pagination token: clients pass it back unchanged and never parse it. */
export const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeCursor(token: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // fall through to the error below
  }
  throw new AppError('VALIDATION_ERROR', 'Invalid request: cursor is not a valid pagination token');
}
