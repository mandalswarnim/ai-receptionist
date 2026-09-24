/**
 * Manages in-memory conversation state for active calls.
 * State is flushed to the database when the call ends.
 */

import { ConversationState, ConversationStep, CallerInfo } from '../types';
import { logger } from '../lib/logger';

// In production you'd back this with Redis for multi-instance resilience.
const activeSessions = new Map<string, ConversationState>();

export function createSession(callSid: string, from: string): ConversationState {
  const state: ConversationState = {
    callSid,
    from,
    step: 'greeting',
    collectedInfo: {},
    turnCount: 0,
    turns: [],
    startedAt: new Date(),
    silentPrompts: 0,
  };
  activeSessions.set(callSid, state);
  logger.info('Conversation session created', { callSid, from });
  return state;
}

export function getSession(callSid: string): ConversationState | undefined {
  return activeSessions.get(callSid);
}

export function addTurn(
  callSid: string,
  role: 'assistant' | 'caller',
  content: string
): void {
  const session = activeSessions.get(callSid);
  if (!session) return;
  session.turns.push({ role, content });
  session.turnCount += 1;
}

export function updateCollectedInfo(callSid: string, info: Partial<CallerInfo>): void {
  const session = activeSessions.get(callSid);
  if (!session) return;
  session.collectedInfo = { ...session.collectedInfo, ...info };
}

export function advanceStep(callSid: string, step: ConversationStep): void {
  const session = activeSessions.get(callSid);
  if (!session) return;
  session.step = step;
  logger.debug('Conversation step advanced', { callSid, step });
}

export function destroySession(callSid: string): ConversationState | undefined {
  const session = activeSessions.get(callSid);
  activeSessions.delete(callSid);
  logger.info('Conversation session destroyed', { callSid });
  return session;
}

/** Removes and returns every session (used on shutdown). */
export function destroyAllSessions(): ConversationState[] {
  return [...activeSessions.keys()]
    .map((callSid) => destroySession(callSid))
    .filter((s): s is ConversationState => !!s);
}

/**
 * Removes and returns sessions older than maxAgeMs. Normally every session is
 * closed by a hangup, a socket close or the call-status webhook; this catches
 * the ones whose closing event never arrived (e.g. no statusCallback set on
 * the Twilio number) so they don't leak and their message still gets sent.
 */
export function destroyStaleSessions(maxAgeMs: number): ConversationState[] {
  const cutoff = Date.now() - maxAgeMs;
  return [...activeSessions.values()]
    .filter((s) => s.startedAt.getTime() < cutoff)
    .map((s) => destroySession(s.callSid))
    .filter((s): s is ConversationState => !!s);
}

export function getActiveSessionCount(): number {
  return activeSessions.size;
}
