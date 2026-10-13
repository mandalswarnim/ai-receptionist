import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../../config';
import { logger } from '../../lib/logger';

// ─── Admin auth ──────────────────────────────────────────────────────────────
//
// Call records contain names, numbers and messages from real people. Admin
// routes require `Authorization: Bearer <key>`, and without ADMIN_API_KEY the
// admin API is disabled — in every environment, so a deploy that forgets
// NODE_ENV=production isn't left open.

if (!config.ADMIN_API_KEY) {
  logger.warn('ADMIN_API_KEY is not set — the admin API is disabled');
}

export function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  const expected = config.ADMIN_API_KEY;
  if (!expected) {
    res.status(503).json({ error: 'Admin API disabled: set ADMIN_API_KEY' });
    return;
  }
  const header = req.headers.authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error('Unhandled error', {
    url: req.url,
    method: req.method,
    message: err.message,
    stack: err.stack,
  });

  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
}
