/**
 * The active demo: which DEMO business answers calls to our number during a
 * sales call. Held in memory with a short TTL, so a forgotten demo can't keep
 * answering for long. Calls that started before it changed are unaffected:
 * each call fixes its business when it starts.
 */

export const ACTIVE_DEMO_TTL_MS = 30 * 60_000;

export interface ActiveDemo {
  businessId: string;
  expiresAt: Date;
}

let active: ActiveDemo | undefined;

export function setActiveDemo(businessId: string, now = new Date()): ActiveDemo {
  active = { businessId, expiresAt: new Date(now.getTime() + ACTIVE_DEMO_TTL_MS) };
  return active;
}

export function getActiveDemo(now = new Date()): ActiveDemo | undefined {
  if (active && active.expiresAt <= now) active = undefined;
  return active;
}

export function clearActiveDemo(): void {
  active = undefined;
}

// ─── Cockpit hand-off ────────────────────────────────────────────────────────
//
// "Bring in demo" in the calling cockpit adds a call leg from our own number.
// When that leg reaches the incoming-call webhook it claims the pub queued
// here, so the AI answers as that pub without an active demo being set for
// everyone else.

const COCKPIT_CLAIM_TTL_MS = 60_000;

let pendingCockpitDemo:
  | { businessId: string; expiresAt: number; onClaim: (callSid: string) => void }
  | undefined;

/** Calls answered for the cockpit, so post-call processing can tell them apart. */
const cockpitCalls = new Set<string>();

export function expectCockpitDemo(businessId: string, onClaim: (callSid: string) => void): void {
  pendingCockpitDemo = { businessId, expiresAt: Date.now() + COCKPIT_CLAIM_TTL_MS, onClaim };
}

export function cancelCockpitDemo(): void {
  pendingCockpitDemo = undefined;
}

/** Single use: returns the queued business for the cockpit's demo leg. */
export function claimCockpitDemo(callSid: string): string | undefined {
  const pending = pendingCockpitDemo;
  pendingCockpitDemo = undefined;
  if (!pending || pending.expiresAt < Date.now()) return undefined;
  cockpitCalls.add(callSid);
  pending.onClaim(callSid);
  return pending.businessId;
}

/** True (once) for a call answered for the cockpit. */
export function takeCockpitCall(callSid: string): boolean {
  return cockpitCalls.delete(callSid);
}
