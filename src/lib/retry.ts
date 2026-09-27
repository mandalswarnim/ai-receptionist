/**
 * Runs `fn` until it succeeds or `attempts` is exhausted, waiting
 * `baseDelayMs * 4^n` between tries (e.g. 2s, 8s, 32s). Rethrows the last
 * error when every attempt fails.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; onRetry?: (err: unknown, attempt: number) => void } = {}
): Promise<T> {
  const { attempts = 3, baseDelayMs = 2000, onRetry } = opts;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      onRetry?.(err, attempt);
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 4 ** (attempt - 1)));
    }
  }
  throw lastErr;
}
