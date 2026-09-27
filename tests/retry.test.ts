import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../src/lib/retry';

describe('withRetry', () => {
  it('returns the first successful result', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    await expect(withRetry(fn, { baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rethrows the last error once attempts are exhausted', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValue(new Error('down'));
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1, onRetry })).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});
