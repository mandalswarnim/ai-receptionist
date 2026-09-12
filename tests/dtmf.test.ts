import { describe, it, expect, vi } from 'vitest';
import { DtmfBuffer, formatDtmfUtterance } from '../src/lib/dtmf';

describe('DtmfBuffer', () => {
  it('submits on hash immediately', () => {
    const done = vi.fn();
    const b = new DtmfBuffer(done, 1000);
    for (const d of '0770090012#') b.push(d);
    expect(done).toHaveBeenCalledWith('0770090012');
  });

  it('submits after the idle timeout', () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const b = new DtmfBuffer(done, 1000);
    for (const d of '123') b.push(d);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledWith('123');
    vi.useRealTimers();
  });

  it('star clears the buffer so the caller can start over', () => {
    const done = vi.fn();
    const b = new DtmfBuffer(done, 1000);
    for (const d of '99*123#') b.push(d);
    expect(done).toHaveBeenCalledWith('123');
  });

  it('ignores an empty flush', () => {
    const done = vi.fn();
    const b = new DtmfBuffer(done, 1000);
    b.push('#');
    b.flush();
    expect(done).not.toHaveBeenCalled();
  });

  it('formats keypad input so the model treats it as exact', () => {
    expect(formatDtmfUtterance('123')).toBe('[Caller typed on keypad: 123]');
  });
});
