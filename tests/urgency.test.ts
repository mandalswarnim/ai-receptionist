import { describe, it, expect } from 'vitest';
import { normalizeUrgency } from '../src/lib/urgency';

describe('normalizeUrgency', () => {
  it.each([
    ['low', 'low'],
    ['Medium', 'medium'],
    ['HIGH', 'high'],
    [' urgent ', 'urgent'],
    ['Urgent!', 'urgent'],
    ['high priority', 'high'],
    ['not urgent', 'low'],
    ['emergency', 'urgent'],
    ['ASAP', 'urgent'],
    ['whenever', 'medium'],
    [undefined, 'medium'],
    [42, 'medium'],
  ])('%j → %s', (input, expected) => {
    expect(normalizeUrgency(input)).toBe(expected);
  });
});
