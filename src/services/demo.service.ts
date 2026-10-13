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
