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

/**
 * UK number as E.164 for dialling: "020 7946 0000", "+44 (0)20 7946 0000"
 * and "0044 20..." all become "+442079460000". Returns undefined for
 * anything that isn't a plausible UK number.
 */
export function toUkE164(value: string): string | undefined {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('0044')) digits = digits.slice(2);
  if (digits.startsWith('44')) {
    digits = digits.slice(2);
    if (digits.startsWith('0')) digits = digits.slice(1);
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  } else {
    return undefined;
  }
  return /^[1-9]\d{8,9}$/.test(digits) ? `+44${digits}` : undefined;
}
