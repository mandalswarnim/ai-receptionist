import { UrgencyLevel } from '../types';

export const URGENCY_VALUES: UrgencyLevel[] = ['low', 'medium', 'high', 'urgent'];

/**
 * Coerces whatever the model wrote for urgency ("Urgent", "HIGH priority",
 * "not urgent"...) onto the enum the database accepts. An invalid value here
 * used to make the Prisma write throw, which failed the whole call and
 * dropped the email.
 */
export function normalizeUrgency(value: unknown, fallback: UrgencyLevel = 'medium'): UrgencyLevel {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  if (URGENCY_VALUES.includes(v as UrgencyLevel)) return v as UrgencyLevel;
  if (/\bnot\b.*\burgent\b|\blow\b/.test(v)) return 'low';
  if (/\burgent\b|\bemergency\b|\bcritical\b|\basap\b/.test(v)) return 'urgent';
  if (/\bhigh\b/.test(v)) return 'high';
  return fallback;
}
