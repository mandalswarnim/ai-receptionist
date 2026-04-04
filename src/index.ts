import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { config, isDev } from './config';
import { logger } from './lib/logger';
import { connectDb, disconnectDb } from './lib/db';
import webhookRoutes from './api/routes/webhooks';
import callRoutes from './api/routes/calls';
import { notFound, errorHandler } from './api/middleware';

const app = express();

// ─── Security ────────────────────────────────────────────────────────────────

app.use(
  helmet({
    // Twilio posts XML — disable default CSP for webhooks
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: isDev ? '*' : config.BASE_URL,
    methods: ['GET', 'POST', 'DELETE'],
  })
);

// ─── Parsing ─────────────────────────────────────────────────────────────────

// Twilio sends URL-encoded form data
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── Logging ─────────────────────────────────────────────────────────────────

app.use(
  morgan(isDev ? 'dev' : 'combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  })
);

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use('/api/webhooks', webhookRoutes);
app.use('/api/calls', callRoutes);

// ─── Error handling ──────────────────────────────────────────────────────────

app.use(notFound);
app.use(errorHandler);

// ─── Startup ─────────────────────────────────────────────────────────────────

async function start() {
  await connectDb();

  const server = app.listen(config.PORT, () => {
    logger.info(`AI Receptionist running`, {
      port: config.PORT,
      env: config.NODE_ENV,
      company: config.COMPANY_NAME,
      twilioNumber: config.TWILIO_PHONE_NUMBER,
    });
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { err });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
    process.exit(1);
  });
}

start().catch((err) => {
  logger.error('Failed to start server', { err });
  process.exit(1);
});

export default app;
