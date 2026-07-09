/**
 * Twilio webhook endpoints.
 *
 * Call flow:
 *   Customer calls business → Business doesn't answer → Call forwarded to
 *   our Twilio number → AI picks up immediately → Collects info → Emails business.
 *
 * Two conversation modes (USE_CONVERSATION_RELAY):
 *   true  — Twilio ConversationRelay streams speech over a WebSocket
 *           (see relay.service.ts); only recording/status webhooks fire here.
 *   false — classic <Gather>/<Say> webhook loop handled below.
 *
 * POST /api/webhooks/incoming-call   — Twilio calls this when a forwarded call arrives
 * POST /api/webhooks/gather          — Fires each time the caller speaks (webhook mode)
 * POST /api/webhooks/recording       — Fires when call recording is ready
 * POST /api/webhooks/call-status     — Fires on final call status change
 */

import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import {
  TwilioCallPayload,
  TwilioGatherPayload,
  TwilioRecordingPayload,
} from '../../types';
import * as conversationSvc from '../../services/conversation.service';
import * as aiSvc from '../../services/ai.service';
import * as twilioSvc from '../../services/twilio.service';
import * as callSvc from '../../services/call.service';

const router = Router();

// ─── Twilio request validation middleware ────────────────────────────────────

function validateTwilioSignature(req: Request, res: Response, next: () => void): void {
  if (config.NODE_ENV === 'development') {
    // Skip validation in dev (useful with ngrok)
    next();
    return;
  }

  const isValid = twilio.validateRequest(
    config.TWILIO_AUTH_TOKEN,
    req.headers['x-twilio-signature'] as string,
    `${config.BASE_URL}${req.originalUrl}`,
    req.body as Record<string, string>
  );

  if (!isValid) {
    logger.warn('Invalid Twilio signature', { url: req.originalUrl });
    res.status(403).send('Forbidden');
    return;
  }

  next();
}

// Apply Twilio validation to all webhook routes
router.use(validateTwilioSignature);

// ─── 1. Incoming Call (forwarded from business) ──────────────────────────────
//
// The business phone didn't answer, so the call was forwarded to our Twilio
// number. The AI picks up immediately — no further dial attempt needed.

router.post('/incoming-call', async (req: Request, res: Response) => {
  const body = req.body as TwilioCallPayload;
  const { CallSid: callSid, From: from } = body;

  logger.info('Forwarded call received — AI answering', { callSid, from });

  try {
    const greeting = aiSvc.buildGreeting();

    if (config.USE_CONVERSATION_RELAY) {
      // Session setup happens when the WebSocket connects (relay.service.ts)
      res.type('text/xml').send(twilioSvc.buildRelayTwiml(greeting));
      return;
    }

    // Webhook mode: save record, start session, greet and listen
    await callSvc.createInitialCallRecord(callSid, from);

    conversationSvc.createSession(callSid, from);
    conversationSvc.addTurn(callSid, 'assistant', greeting);
    conversationSvc.advanceStep(callSid, 'collect_name');

    void twilioSvc.startCallRecording(callSid);

    res.type('text/xml').send(twilioSvc.buildGreetingTwiml(callSid, greeting));
  } catch (err) {
    logger.error('Error handling incoming call', { callSid, err });
    res.type('text/xml').send(twilioSvc.buildErrorTwiml());
  }
});

// ─── 2. Gather (Speech Input — webhook mode only) ────────────────────────────

router.post('/gather', async (req: Request, res: Response) => {
  const body = req.body as TwilioGatherPayload;
  const callSid = (req.query['callSid'] as string) || body.CallSid;
  const speechResult = body.SpeechResult;
  const noInput = req.query['noInput'] === 'true';

  logger.info('Gather received', { callSid, speechResult, noInput });

  let state = conversationSvc.getSession(callSid);

  // Auto-create session if one doesn't exist (e.g. inline TwiML test calls)
  if (!state) {
    logger.info('No session found — creating one for gather', { callSid });
    const from = body.From || 'unknown';
    state = conversationSvc.createSession(callSid, from);
    const greeting = aiSvc.buildGreeting();
    conversationSvc.addTurn(callSid, 'assistant', greeting);
    conversationSvc.advanceStep(callSid, 'collect_name');
    await callSvc.createInitialCallRecord(callSid, from);
    void twilioSvc.startCallRecording(callSid);
  }

  // Handle silence / no input
  if (noInput || !speechResult) {
    const prompt =
      state.turnCount < 2
        ? "Sorry, I didn't catch that — could you say it again for me?"
        : "No rush — I'm still here whenever you're ready.";

    res.type('text/xml').send(twilioSvc.buildGatherTwiml(callSid, prompt));
    return;
  }

  // Log caller turn
  conversationSvc.addTurn(callSid, 'caller', speechResult);

  try {
    // Generate AI response
    const { response, nextStep, extracted } = await aiSvc.generateResponse(state);

    // Track what the AI has collected so far so it never re-asks
    if (Object.keys(extracted).length > 0) {
      conversationSvc.updateCollectedInfo(callSid, extracted);
    }

    // Update step
    conversationSvc.advanceStep(callSid, nextStep);
    conversationSvc.addTurn(callSid, 'assistant', response);

    // Check if call should close
    if (nextStep === 'closing') {
      logger.info('Conversation closing', { callSid });

      const finalState = conversationSvc.destroySession(callSid);

      // Process the call asynchronously (don't block the TwiML response)
      if (finalState) {
        setImmediate(() => {
          callSvc
            .processCompletedCall(finalState)
            .catch((err) => logger.error('Post-call processing failed', { callSid, err }));
        });
      }

      res.type('text/xml').send(twilioSvc.buildClosingTwiml(response));
      return;
    }

    // Continue gathering
    res.type('text/xml').send(twilioSvc.buildGatherTwiml(callSid, response));
  } catch (err) {
    logger.error('Error in gather handler', { callSid, err });
    res.type('text/xml').send(twilioSvc.buildGatherTwiml(
      callSid,
      "Sorry, I lost you for a second there. Could you say that again?"
    ));
  }
});

// ─── 3. Recording Callback ───────────────────────────────────────────────────
//
// Fires shortly after the call ends. The summary email has usually already
// gone out (built from the live conversation), so this upgrades the stored
// transcript with an accurate audio transcription and backfills any details
// the live conversation missed.

router.post('/recording', async (req: Request, res: Response) => {
  const body = req.body as TwilioRecordingPayload;
  const { CallSid: callSid, RecordingUrl: recordingUrl, RecordingSid: recordingSid, RecordingDuration } = body;

  logger.info('Recording ready', { callSid, recordingUrl, duration: RecordingDuration });

  // Acknowledge immediately
  res.sendStatus(204);

  const duration = parseInt(RecordingDuration ?? '0', 10);

  callSvc
    .enhanceCallWithRecording(callSid, recordingUrl, recordingSid, duration)
    .catch((err) => logger.error('Error processing recording', { callSid, err }));
});

// ─── 4. Call Status Callback ─────────────────────────────────────────────────

router.post('/call-status', async (req: Request, res: Response) => {
  const body = req.body as TwilioCallPayload & { CallDuration?: string };
  const { CallSid: callSid, CallStatus: callStatus, CallDuration } = body;

  logger.info('Call status update', { callSid, callStatus });

  res.sendStatus(204);

  // Handle calls that ended unexpectedly (e.g., caller hung up mid-conversation).
  // destroySession() is the mutex: whichever handler destroys the session first
  // (this one, gather's closing branch, or the relay socket close) processes it.
  const session = conversationSvc.getSession(callSid);
  if (session && (callStatus === 'completed' || callStatus === 'failed')) {
    logger.info('Call ended with active session — processing', { callSid, callStatus });
    const finalState = conversationSvc.destroySession(callSid);

    if (finalState && finalState.turns.some((t) => t.role === 'caller')) {
      setImmediate(() => {
        callSvc
          .processCompletedCall(
            finalState,
            undefined,
            undefined,
            CallDuration ? parseInt(CallDuration, 10) : undefined
          )
          .catch((err) => logger.error('Post-call processing failed', { callSid, err }));
      });
    } else if (finalState) {
      // Caller never said anything — close the record without emailing
      callSvc
        .markCallCompleted(callSid)
        .catch((err) => logger.error('Failed to close call record', { callSid, err }));
    }
  }
});

export default router;
