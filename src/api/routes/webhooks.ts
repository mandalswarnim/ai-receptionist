/**
 * Twilio webhook endpoints.
 *
 * POST /api/webhooks/incoming-call   — Twilio calls this when a new call arrives
 * POST /api/webhooks/dial-status     — Fires when the dial attempt ends
 * POST /api/webhooks/gather          — Fires each time the caller speaks
 * POST /api/webhooks/recording       — Fires when call recording is ready
 * POST /api/webhooks/call-status     — Fires on final call status change
 */

import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import {
  TwilioCallPayload,
  TwilioDialStatusPayload,
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

// ─── 1. Incoming Call ────────────────────────────────────────────────────────

router.post('/incoming-call', async (req: Request, res: Response) => {
  const body = req.body as TwilioCallPayload;
  const { CallSid: callSid, From: from } = body;

  logger.info('Incoming call received', { callSid, from });

  try {
    // Record the call immediately
    await callSvc.createInitialCallRecord(callSid, from);

    // Try to forward to human receptionist first
    const twiml = twilioSvc.buildIncomingCallTwiml();

    res.type('text/xml').send(twiml);
  } catch (err) {
    logger.error('Error handling incoming call', { callSid, err });
    res.type('text/xml').send(twilioSvc.buildErrorTwiml());
  }
});

// ─── 2. Dial Status Callback ─────────────────────────────────────────────────

router.post('/dial-status', async (req: Request, res: Response) => {
  const body = req.body as TwilioDialStatusPayload;
  const { CallSid: callSid, From: from, DialCallStatus: dialStatus } = body;

  logger.info('Dial status received', { callSid, dialStatus });

  // If the receptionist answered, call is handled — nothing more to do
  if (dialStatus === 'completed') {
    logger.info('Receptionist answered — call transferred', { callSid });
    res.type('text/xml').send('<Response></Response>');
    return;
  }

  // Receptionist did not answer → AI takes over
  logger.info('Receptionist unavailable — AI taking over', { callSid, dialStatus });

  try {
    // Start a conversation session
    conversationSvc.createSession(callSid, from);
    const greeting = aiSvc.buildGreeting();

    conversationSvc.addTurn(callSid, 'assistant', greeting);
    conversationSvc.advanceStep(callSid, 'collect_name');

    const twiml = twilioSvc.buildGreetingTwiml(callSid, greeting);
    res.type('text/xml').send(twiml);
  } catch (err) {
    logger.error('Error starting AI session', { callSid, err });
    res.type('text/xml').send(twilioSvc.buildErrorTwiml());
  }
});

// ─── 3. Gather (Speech Input) ────────────────────────────────────────────────

router.post('/gather', async (req: Request, res: Response) => {
  const body = req.body as TwilioGatherPayload;
  const callSid = (req.query['callSid'] as string) || body.CallSid;
  const speechResult = body.SpeechResult;
  const noInput = req.query['noInput'] === 'true';

  logger.info('Gather received', { callSid, speechResult, noInput });

  const state = conversationSvc.getSession(callSid);

  if (!state) {
    logger.warn('No session found for gather', { callSid });
    res.type('text/xml').send(twilioSvc.buildErrorTwiml());
    return;
  }

  // Handle silence / no input
  if (noInput || !speechResult) {
    const prompt =
      state.turnCount < 2
        ? "I'm sorry, I didn't hear you. Could you please speak your response?"
        : "I'm still here — please go ahead and speak when you're ready.";

    res.type('text/xml').send(twilioSvc.buildGatherTwiml(callSid, prompt));
    return;
  }

  // Log caller turn
  conversationSvc.addTurn(callSid, 'caller', speechResult);

  try {
    // Generate AI response
    const { response, nextStep } = await aiSvc.generateResponse(state, speechResult);

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
      "I'm sorry, I had a technical issue. Could you please repeat what you said?"
    ));
  }
});

// ─── 4. Recording Callback ───────────────────────────────────────────────────

router.post('/recording', async (req: Request, res: Response) => {
  const body = req.body as TwilioRecordingPayload;
  const { CallSid: callSid, RecordingUrl: recordingUrl, RecordingSid: recordingSid, RecordingDuration } = body;

  logger.info('Recording ready', { callSid, recordingUrl, duration: RecordingDuration });

  // Acknowledge immediately
  res.sendStatus(204);

  // Re-process the call with the actual recording URL if we have a state for it,
  // or update the DB record if processing already happened.
  const duration = parseInt(RecordingDuration ?? '0', 10);

  try {
    const existingCall = await import('../../lib/db').then(({ db }) =>
      db.call.findUnique({ where: { callSid } })
    );

    if (existingCall && !existingCall.recordingUrl) {
      const { db } = await import('../../lib/db');
      await db.call.update({
        where: { callSid },
        data: { recordingUrl, recordingSid, duration },
      });
      logger.info('Recording URL saved to existing call record', { callSid });
    }
  } catch (err) {
    logger.error('Error saving recording URL', { callSid, err });
  }
});

// ─── 5. Call Status Callback ─────────────────────────────────────────────────

router.post('/call-status', async (req: Request, res: Response) => {
  const body = req.body as TwilioCallPayload & { CallDuration?: string };
  const { CallSid: callSid, CallStatus: callStatus, CallDuration } = body;

  logger.info('Call status update', { callSid, callStatus });

  res.sendStatus(204);

  // Handle calls that ended unexpectedly (e.g., caller hung up mid-conversation)
  const session = conversationSvc.getSession(callSid);
  if (session && (callStatus === 'completed' || callStatus === 'failed')) {
    logger.info('Call ended with active session — processing', { callSid, callStatus });
    const finalState = conversationSvc.destroySession(callSid);

    if (finalState && finalState.turns.length > 0) {
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
    }
  }
});

export default router;
