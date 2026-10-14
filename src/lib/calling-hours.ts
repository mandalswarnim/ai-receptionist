/**
 * When sales calls may be dialled. Prospects are UK businesses, so the
 * window is always UK time regardless of COMPANY_TIMEZONE.
 *
 * Spec format: "Mon-Fri 09:00-20:00; Sat 10:00-17:00" — day or day range,
 * then a time range; rules separated by ";" or ",".
 */

export const DEFAULT_CALLING_HOURS = 'Mon-Fri 09:00-20:00; Sat 10:00-17:00';
const TIMEZONE = 'Europe/London';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface CallingRule {
  days: number[]; // 0 = Mon
  from: number; // minutes since midnight
  to: number;
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

export function parseCallingHours(spec: string): CallingRule[] {
  const rules = spec
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^([A-Za-z]{3})(?:\s*-\s*([A-Za-z]{3}))?\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
      const day = (d: string) => DAYS.findIndex((x) => x.toLowerCase() === d.toLowerCase());
      if (!m) throw new Error(`Can't read calling hours "${part}" (expected e.g. "Mon-Fri 09:00-20:00")`);
      const start = day(m[1]!);
      const end = m[2] ? day(m[2]) : start;
      const from = minutes(m[3]!);
      const to = minutes(m[4]!);
      if (start === -1 || end === -1 || end < start || from >= to || to > 24 * 60) {
        throw new Error(`Can't read calling hours "${part}"`);
      }
      return { days: DAYS.map((_, i) => i).filter((i) => i >= start && i <= end), from, to };
    });
  if (rules.length === 0) throw new Error('Calling hours are empty');
  return rules;
}

/** Day (0 = Mon) and minutes since midnight, UK time. */
function ukClock(now: Date): { day: number; mins: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return { day: DAYS.indexOf(parts['weekday']!), mins: Number(parts['hour']) * 60 + Number(parts['minute']) };
}

export function isWithinCallingHours(now: Date, spec = DEFAULT_CALLING_HOURS): boolean {
  const { day, mins } = ukClock(now);
  return parseCallingHours(spec).some((r) => r.days.includes(day) && mins >= r.from && mins < r.to);
}
