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
    confirmed: false,
  };
  activeSessions.set(callSid, state);
  logger.info('Conversation session created', { callSid, from });
  return state;
}

export function getSession(callSid: string): ConversationState | undefined {
  return activeSessions.get(callSid);
}

export function updateSession(callSid: string, updates: Partial<ConversationState>): ConversationState {
  const existing = activeSessions.get(callSid);
  if (!existing) throw new Error(`No session found for callSid: ${callSid}`);
  const updated = { ...existing, ...updates };
  activeSessions.set(callSid, updated);
  return updated;
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
  activeSessions.set(callSid, session);
}

export function updateCollectedInfo(callSid: string, info: Partial<CallerInfo>): void {
  const session = activeSessions.get(callSid);
  if (!session) return;
  session.collectedInfo = { ...session.collectedInfo, ...info };
  activeSessions.set(callSid, session);
}

export function advanceStep(callSid: string, step: ConversationStep): void {
  const session = activeSessions.get(callSid);
  if (!session) return;
  session.step = step;
  activeSessions.set(callSid, session);
  logger.debug('Conversation step advanced', { callSid, step });
}

export function destroySession(callSid: string): ConversationState | undefined {
  const session = activeSessions.get(callSid);
  activeSessions.delete(callSid);
  logger.info('Conversation session destroyed', { callSid });
  return session;
}

export function getActiveSessionCount(): number {
  return activeSessions.size;
}
