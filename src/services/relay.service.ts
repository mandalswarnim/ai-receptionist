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
import { DtmfBuffer, formatDtmfUtterance } from '../lib/dtmf';

interface RelayMessage {
  type: 'setup' | 'prompt' | 'interrupt' | 'dtmf' | 'error' | 'info';
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
export function speechDurationMs(text: string): number {
  return Math.min(Math.max((text.length / 15) * 1000, 2000), 10_000);
}

export function handleRelayConnection(ws: WebSocket): void {
  let callSid = '';
  // Bumped on every new caller prompt so replies to superseded prompts
  // (e.g. after a barge-in) stop being sent to the caller.
  let promptEpoch = 0;
  // Cancels the in-flight LLM stream when a newer prompt supersedes it.
  let inflight: AbortController | undefined;
  let hangupTimer: NodeJS.Timeout | undefined;

  const submitPrompt = (utterance: string) => {
    inflight?.abort();
    inflight = new AbortController();
    void handlePrompt(ws, callSid, utterance, ++promptEpoch, () => promptEpoch, inflight, (ms) => {
      hangupTimer = setTimeout(() => void endCall(callSid), ms);
      hangupTimer.unref();
    });
  };

  const dtmf = new DtmfBuffer((digits) => {
    logger.info('Relay: keypad input', { callSid, digits });
    submitPrompt(formatDtmfUtterance(digits));
  });

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
        // Speech after the goodbye shouldn't reopen the conversation
        if (hangupTimer) return;
        dtmf.flush();
        submitPrompt(msg.voicePrompt);
        break;
      }

      case 'dtmf': {
        if (hangupTimer || !msg.digit) return;
        dtmf.push(msg.digit);
        break;
      }

      case 'interrupt': {
        // Caller talked over the AI: keep only what was actually spoken so
        // the conversation history matches what the caller heard.
        inflight?.abort();
        const session = conversationSvc.getSession(callSid);
        const lastTurn = session?.turns[session.turns.length - 1];
        if (lastTurn?.role === 'assistant' && msg.utteranceUntilInterrupt) {
          lastTurn.content = msg.utteranceUntilInterrupt;
        }
        logger.debug('Relay: caller interrupted', { callSid });
        break;
      }

      case 'info':
        break;

      case 'error':
        logger.error('Relay: error from Twilio', { callSid, description: msg.description });
        break;
    }
  });

  ws.on('close', () => {
    inflight?.abort();
    dtmf.dispose();
    if (hangupTimer) clearTimeout(hangupTimer);
    if (!callSid) return;
    logger.info('Relay session closed', { callSid });

    const finalState = conversationSvc.destroySession(callSid);
    if (!finalState) return;

    const hasCallerInput = finalState.turns.some((t) => t.role === 'caller');
    if (hasCallerInput) {
      const duration = Math.round((Date.now() - finalState.startedAt.getTime()) / 1000);
      setImmediate(() => {
        callSvc
          .processCompletedCall(finalState, undefined, undefined, duration)
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
  currentEpoch: () => number,
  abort: AbortController,
  scheduleHangup: (ms: number) => void
): Promise<void> {
  const state = conversationSvc.getSession(callSid);
  if (!state) {
    logger.warn('Relay: prompt for unknown session', { callSid });
    return;
  }

  conversationSvc.addTurn(callSid, 'caller', voicePrompt);
  logger.info('Relay: caller said', { callSid, voicePrompt });

  const live = () => currentEpoch() === epoch && ws.readyState === ws.OPEN;
  const startedAt = Date.now();
  let firstTokenAt: number | undefined;

  try {
    const { fullText, endCall: shouldEnd } = await aiSvc.streamResponse(
      state,
      (token) => {
        if (!live()) return;
        firstTokenAt ??= Date.now();
        ws.send(JSON.stringify({ type: 'text', token, last: false }));
      },
      abort.signal
    );

    if (!live()) return; // superseded by a newer prompt or the socket closed

    ws.send(JSON.stringify({ type: 'text', token: '', last: true }));
    conversationSvc.addTurn(callSid, 'assistant', fullText);
    logger.info('Relay: reply sent', {
      callSid,
      ttfbMs: firstTokenAt ? firstTokenAt - startedAt : null,
      totalMs: Date.now() - startedAt,
    });

    if (shouldEnd) {
      logger.info('Relay: conversation complete, ending call', { callSid });
      scheduleHangup(speechDurationMs(fullText));
    }
  } catch (err) {
    if (abort.signal.aborted) return; // superseded — expected
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
