import { describe, it, expect } from 'vitest';
import { isDialableNumber } from '../src/lib/phone';

describe('isDialableNumber', () => {
  it.each(['+447700900123', '+1 (415) 555-1234', '02071234567'])('accepts %s', (n) => {
    expect(isDialableNumber(n)).toBe(true);
  });

  it.each(['anonymous', 'Restricted', '+266696687', '+7378742833', '+2562533', '', undefined, null, 'unknown'])(
    'rejects %s',
    (n) => {
      expect(isDialableNumber(n)).toBe(false);
    }
  );
});
