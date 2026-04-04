import { Request, Response, NextFunction } from 'express';
import { logger } from '../../lib/logger';

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

export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  logger.debug(`${req.method} ${req.path}`, {
    ip: req.ip,
    body: req.body as unknown,
  });
  next();
}
