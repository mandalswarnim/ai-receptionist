/**
 * True when a caller ID is a number someone could call back. Withheld and
 * unknown callers arrive as "anonymous", "Restricted", "+266696687"
 * (Twilio's placeholder for anonymous) and the like.
 */
export function isDialableNumber(value: string | null | undefined): value is string {
  if (!value) return false;
  const digits = value.replace(/[\s()-]/g, '');
  if (digits === '+266696687' || digits === '+7378742833' || digits === '+2562533') return false;
  return /^\+?\d{7,15}$/.test(digits);
}
