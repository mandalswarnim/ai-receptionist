/**
 * ConversationRelay service: handles the WebSocket session for streaming
 * voice calls. Twilio sends transcribed caller speech as JSON messages and
 * speaks any text tokens we send back (ElevenLabs TTS), with native barge-in.
 *
 * Messages from Twilio:  setup, prompt, interrupt, dtmf, error
 * Messages to Twilio:    { type: "text", token, last }
 */

import type { WebSocket } from 'ws';
import { logger } from '../lib/logger';
import * as conversationSvc from './conversation.service';
import * as aiSvc from './ai.service';
import * as callSvc from './call.service';
import { startCallRecording, endCall } from './twilio.service';

interface RelayMessage {
  type: 'setup' | 'prompt' | 'interrupt' | 'dtmf' | 'error';
  callSid?: string;
  from?: string;
  to?: string;
  voicePrompt?: string;
  last?: boolean;
  utteranceUntilInterrupt?: string;
  digit?: string;
  description?: string;
}

/** Rough TTS pacing used to wait for the goodbye to finish before hanging up. */
function speechDurationMs(text: string): number {
  return Math.min(Math.max((text.length / 15) * 1000, 2000), 10_000);
}

export function handleRelayConnection(ws: WebSocket): void {
  let callSid = '';
  // Bumped on every new caller prompt so replies to superseded prompts
  // (e.g. after a barge-in) stop being sent to the caller.
  let promptEpoch = 0;

  ws.on('message', (raw: Buffer) => {
    let msg: RelayMessage;
    try {
      msg = JSON.parse(raw.toString()) as RelayMessage;
    } catch {
      logger.warn('Relay: unparseable message', { raw: raw.toString().slice(0, 200) });
      return;
    }

    switch (msg.type) {
      case 'setup': {
        callSid = msg.callSid ?? '';
        const from = msg.from ?? 'unknown';
        logger.info('Relay session started', { callSid, from });

        conversationSvc.createSession(callSid, from);
        // The welcomeGreeting in the TwiML is spoken by Twilio directly;
        // record it so the transcript is complete.
        conversationSvc.addTurn(callSid, 'assistant', aiSvc.buildGreeting());
        conversationSvc.advanceStep(callSid, 'collect_name');

        callSvc
          .createInitialCallRecord(callSid, from)
          .catch((err) => logger.error('Relay: failed to create call record', { callSid, err }));
        void startCallRecording(callSid);
        break;
      }

      case 'prompt': {
        if (!msg.last || !msg.voicePrompt) return;
        void handlePrompt(ws, callSid, msg.voicePrompt, ++promptEpoch, () => promptEpoch);
        break;
      }

      case 'interrupt': {
        // Caller talked over the AI: keep only what was actually spoken so
        // the conversation history matches what the caller heard.
        const session = conversationSvc.getSession(callSid);
        const lastTurn = session?.turns[session.turns.length - 1];
        if (lastTurn?.role === 'assistant' && msg.utteranceUntilInterrupt) {
          lastTurn.content = msg.utteranceUntilInterrupt;
        }
        logger.debug('Relay: caller interrupted', { callSid });
        break;
      }

      case 'dtmf':
        logger.debug('Relay: DTMF received', { callSid, digit: msg.digit });
        break;

      case 'error':
        logger.error('Relay: error from Twilio', { callSid, description: msg.description });
        break;
    }
  });

  ws.on('close', () => {
    if (!callSid) return;
    logger.info('Relay session closed', { callSid });

    const finalState = conversationSvc.destroySession(callSid);
    if (!finalState) return;

    const hasCallerInput = finalState.turns.some((t) => t.role === 'caller');
    if (hasCallerInput) {
      setImmediate(() => {
        callSvc
          .processCompletedCall(finalState)
          .catch((err) => logger.error('Relay: post-call processing failed', { callSid, err }));
      });
    } else {
      // Caller hung up before saying anything — close out the record quietly.
      callSvc
        .markCallCompleted(callSid)
        .catch((err) => logger.error('Relay: failed to close call record', { callSid, err }));
    }
  });

  ws.on('error', (err: Error) => {
    logger.error('Relay: websocket error', { callSid, err });
  });
}

async function handlePrompt(
  ws: WebSocket,
  callSid: string,
  voicePrompt: string,
  epoch: number,
  currentEpoch: () => number
): Promise<void> {
  const state = conversationSvc.getSession(callSid);
  if (!state) {
    logger.warn('Relay: prompt for unknown session', { callSid });
    return;
  }

  conversationSvc.addTurn(callSid, 'caller', voicePrompt);
  logger.info('Relay: caller said', { callSid, voicePrompt });

  const live = () => currentEpoch() === epoch && ws.readyState === ws.OPEN;

  try {
    const { fullText, endCall: shouldEnd } = await aiSvc.streamResponse(state, (token) => {
      if (live()) ws.send(JSON.stringify({ type: 'text', token, last: false }));
    });

    if (!live()) return; // superseded by a newer prompt or the socket closed

    ws.send(JSON.stringify({ type: 'text', token: '', last: true }));
    conversationSvc.addTurn(callSid, 'assistant', fullText);

    if (shouldEnd) {
      logger.info('Relay: conversation complete, ending call', { callSid });
      setTimeout(() => void endCall(callSid), speechDurationMs(fullText)).unref();
    }
  } catch (err) {
    logger.error('Relay: response generation failed', { callSid, err });
    if (live()) {
      ws.send(
        JSON.stringify({
          type: 'text',
          token: "Sorry, I lost you for a second there. Could you say that again?",
          last: true,
        })
      );
    }
  }
}
