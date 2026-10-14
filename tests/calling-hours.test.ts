import { describe, it, expect } from 'vitest';
import { isWithinCallingHours, parseCallingHours } from '../src/lib/calling-hours';
import { toUkE164 } from '../src/lib/phone';

describe('calling hours (UK time)', () => {
  it.each([
    ['2026-10-14T07:59:00Z', false], // Wed 08:59 BST
    ['2026-10-14T08:00:00Z', true], // Wed 09:00 BST
    ['2026-10-14T18:59:00Z', true], // Wed 19:59 BST
    ['2026-10-14T19:00:00Z', false], // Wed 20:00 BST
    ['2026-10-17T09:00:00Z', true], // Sat 10:00 BST
    ['2026-10-17T16:00:00Z', false], // Sat 17:00 BST
    ['2026-10-18T12:00:00Z', false], // Sunday
    ['2026-12-02T09:00:00Z', true], // Wed 09:00 GMT (winter, UTC = UK)
    ['2026-12-02T08:59:00Z', false],
  ])('%s → %s', (iso, open) => {
    expect(isWithinCallingHours(new Date(iso))).toBe(open);
  });

  it('accepts a custom spec', () => {
    expect(isWithinCallingHours(new Date('2026-10-18T12:00:00Z'), 'Sun 12:00-14:00')).toBe(true);
  });

  it('rejects specs it cannot read', () => {
    expect(() => parseCallingHours('weekdays 9-5')).toThrow("Can't read calling hours");
    expect(() => parseCallingHours('Fri-Mon 09:00-17:00')).toThrow();
    expect(() => parseCallingHours('Mon 17:00-09:00')).toThrow();
    expect(() => parseCallingHours('')).toThrow();
  });
});

describe('toUkE164', () => {
  it.each([
    ['020 7946 0000', '+442079460000'],
    ['+44 (0)20 7946 0000', '+442079460000'],
    ['0044 1628 000000', '+441628000000'],
    ['07700 900123', '+447700900123'],
    ['+44 7700 900123', '+447700900123'],
  ])('%s → %s', (input, e164) => {
    expect(toUkE164(input)).toBe(e164);
  });

  it.each(['', '12345', '+1 415 555 0100', '020 794'])('rejects %s', (input) => {
    expect(toUkE164(input)).toBeUndefined();
  });
});
