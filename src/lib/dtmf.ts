/** Silence after the last keypress before a typed number is submitted. */
const DTMF_IDLE_MS = 2500;

/**
 * Collects keypad digits into one caller turn. Callers can end entry early
 * with '#'; otherwise the buffer is submitted after a short pause. Typed
 * digits are exact, which sidesteps speech recognition for phone numbers.
 */
export class DtmfBuffer {
  private digits = '';
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly onComplete: (digits: string) => void,
    private readonly idleMs: number = DTMF_IDLE_MS
  ) {}

  push(digit: string): void {
    if (this.timer) clearTimeout(this.timer);
    if (digit === '#') {
      this.flush();
      return;
    }
    if (digit === '*') {
      // Backspace-style correction: start over
      this.digits = '';
    } else if (/^\d$/.test(digit)) {
      this.digits += digit;
    }
    this.timer = setTimeout(() => this.flush(), this.idleMs);
    this.timer.unref?.();
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const out = this.digits;
    this.digits = '';
    if (out) this.onComplete(out);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.digits = '';
  }
}

/** Formats keypad input so the model (and the extractor) treat it as exact. */
export function formatDtmfUtterance(digits: string): string {
  return `[Caller typed on keypad: ${digits}]`;
}
