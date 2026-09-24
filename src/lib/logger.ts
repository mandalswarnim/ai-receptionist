import winston from 'winston';
import { isDev, isProd } from '../config';

const format = isDev
  ? winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} [${level}] ${message}${metaStr}`;
      })
    )
  : winston.format.combine(winston.format.timestamp(), winston.format.json());

const ROTATION = { maxsize: 5 * 1024 * 1024, maxFiles: 3, tailable: true };

export const logger = winston.createLogger({
  level: isDev ? 'debug' : 'info',
  format,
  // Production logs go to stdout for the host to collect and retain — local
  // files there are unbounded, often ephemeral, and hold caller details.
  // Elsewhere, files are kept for convenience but capped (3 × 5 MB each).
  transports: [
    new winston.transports.Console(),
    ...(isProd
      ? []
      : [
          new winston.transports.File({ filename: 'logs/error.log', level: 'error', ...ROTATION }),
          new winston.transports.File({ filename: 'logs/combined.log', ...ROTATION }),
        ]),
  ],
});
