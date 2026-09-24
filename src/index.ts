import express from 'express';
import http from 'http';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { WebSocketServer } from 'ws';
import { config, isDev, relayAuthToken } from './config';
import { logger } from './lib/logger';
import { connectDb, disconnectDb } from './lib/db';
import webhookRoutes from './api/routes/webhooks';
import callRoutes from './api/routes/calls';
import { notFound, errorHandler } from './api/middleware';
import { handleRelayConnection } from './services/relay.service';
import {
  resendPendingEmails,
  finishCall,
  drainPostCallTasks,
  pendingPostCallCount,
} from './services/call.service';
import { destroyAllSessions, destroyStaleSessions } from './services/conversation.service';

const EMAIL_SWEEP_INTERVAL_MS = 10 * 60_000;
const SESSION_SWEEP_INTERVAL_MS = 60_000;

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

  const server = http.createServer(app);

  // ConversationRelay streams caller speech to this WebSocket (see relay.service.ts)
  const wss = new WebSocketServer({
    server,
    path: '/api/relay',
    // Twilio doesn't sign WebSocket upgrades, so the TwiML embeds a shared
    // secret in the URL and we reject anything without it.
    verifyClient: ({ req }, done) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const ok = url.searchParams.get('token') === relayAuthToken;
      if (!ok) logger.warn('Relay: rejected unauthenticated websocket', { ip: req.socket.remoteAddress });
      done(ok, 401, 'Unauthorized');
    },
  });
  wss.on('connection', handleRelayConnection);

  // Retry summary emails that never went out (SMTP outage, restart mid-send)
  const sweepEmails = () =>
    resendPendingEmails().catch((err) => logger.error('Email resend sweep failed', { err }));
  void sweepEmails();
  const emailSweep = setInterval(sweepEmails, EMAIL_SWEEP_INTERVAL_MS);
  emailSweep.unref();

  // Close out sessions whose end-of-call event never arrived. Live calls are
  // capped at MAX_CALL_DURATION_S, so anything well past that is abandoned.
  const sessionSweep = setInterval(() => {
    const stale = destroyStaleSessions((config.MAX_CALL_DURATION_S + 300) * 1000);
    for (const state of stale) {
      logger.warn('Closing abandoned session', { callSid: state.callSid });
      finishCall(state);
    }
  }, SESSION_SWEEP_INTERVAL_MS);
  sessionSweep.unref();

  server.listen(config.PORT, () => {
    logger.info(`AI Receptionist running`, {
      port: config.PORT,
      env: config.NODE_ENV,
      company: config.COMPANY_NAME,
      twilioNumber: config.TWILIO_PHONE_NUMBER,
      mode: config.USE_CONVERSATION_RELAY ? 'conversation-relay' : 'gather-webhook',
      voice: config.USE_CONVERSATION_RELAY
        ? `${config.RELAY_TTS_PROVIDER}/${config.RELAY_VOICE}`
        : config.TTS_VOICE,
    });
  });

  // Graceful shutdown. Order matters: stop taking calls, give live calls a
  // chance to finish, then make sure every finished call's email goes out
  // before exiting — a deploy must not silently drop messages.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = Date.now() + config.SHUTDOWN_TIMEOUT_MS;
    logger.info(`${signal} received — shutting down gracefully`, {
      liveCalls: wss.clients.size,
      pendingPostCall: pendingPostCallCount(),
    });
    setTimeout(() => {
      logger.error('Shutdown timed out — exiting with work still pending', {
        liveCalls: wss.clients.size,
        pendingPostCall: pendingPostCallCount(),
      });
      process.exit(1);
    }, config.SHUTDOWN_TIMEOUT_MS).unref();

    clearInterval(emailSweep);
    clearInterval(sessionSweep);
    server.close();
    server.closeIdleConnections();

    // 1. Let live calls finish, using up to half the budget.
    const liveCallDeadline = Date.now() + config.SHUTDOWN_TIMEOUT_MS / 2;
    while (wss.clients.size > 0 && Date.now() < liveCallDeadline) {
      await new Promise((r) => setTimeout(r, 500));
    }

    // 2. Cut any that remain. Their close handlers queue post-call
    //    processing, so what the caller said so far is still emailed.
    await Promise.all(
      [...wss.clients].map(
        (ws) =>
          new Promise<void>((resolve) => {
            ws.once('close', () => resolve());
            ws.terminate();
          })
      )
    );
    // Webhook-mode calls have no socket; hand their sessions over directly.
    for (const state of destroyAllSessions()) finishCall(state);

    // 3. Wait for emails to go out.
    await Promise.race([
      drainPostCallTasks(),
      new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now() - 1000))),
    ]);

    const unfinished = pendingPostCallCount();
    if (unfinished > 0) {
      logger.warn('Exiting with post-call processing unfinished — saved calls will be emailed by the resend sweep after restart', {
        unfinished,
      });
    }
    await disconnectDb().catch(() => undefined);
    process.exit(unfinished === 0 ? 0 : 1);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { err });
    process.exit(1);
  });

  // A stray rejected promise shouldn't take down every live call and every
  // pending email with it. Log it loudly and keep serving.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
  });
}

start().catch((err) => {
  logger.error('Failed to start server', { err });
  process.exit(1);
});

export default app;
