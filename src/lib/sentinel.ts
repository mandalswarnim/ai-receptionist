/** Sentinel the model appends after its goodbye so we know to hang up. */
export const END_CALL_TOKEN = '[END_CALL]';

/**
 * Filters the END_CALL sentinel out of a token stream. Holds back any trailing
 * text that could be the start of the sentinel so it is never spoken, even
 * when the sentinel is split across chunks.
 */
export class SentinelFilter {
  private pending = '';
  public spoken = '';
  public endCall = false;

  constructor(private readonly onToken: (token: string) => void) {}

  /** Feeds a chunk. Returns false once the sentinel has been seen (stop reading). */
  push(delta: string): boolean {
    if (!delta) return true;
    this.pending += delta;

    const idx = this.pending.indexOf(END_CALL_TOKEN);
    if (idx !== -1) {
      this.endCall = true;
      this.pending = this.pending.slice(0, idx);
      this.flush(true);
      return false;
    }
    this.flush(false);
    return true;
  }

  /** Emits everything still held back. Call once the stream has ended. */
  end(): void {
    this.flush(true);
  }

  private flush(final: boolean): void {
    let safeLen = this.pending.length;
    if (!final) {
      for (let keep = Math.min(END_CALL_TOKEN.length - 1, this.pending.length); keep > 0; keep--) {
        if (END_CALL_TOKEN.startsWith(this.pending.slice(this.pending.length - keep))) {
          safeLen = this.pending.length - keep;
          break;
        }
      }
    }
    if (safeLen > 0) {
      const out = this.pending.slice(0, safeLen);
      this.pending = this.pending.slice(safeLen);
      this.spoken += out;
      this.onToken(out);
    }
  }
}
