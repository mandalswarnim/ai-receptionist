import { describe, it, expect } from 'vitest';
import { SentinelFilter, END_CALL_TOKEN } from '../src/lib/sentinel';

function run(chunks: string[]) {
  const out: string[] = [];
  const f = new SentinelFilter((t) => out.push(t));
  for (const c of chunks) if (!f.push(c)) break;
  f.end();
  return { out: out.join(''), spoken: f.spoken, endCall: f.endCall };
}

describe('SentinelFilter', () => {
  it('passes plain text through unchanged', () => {
    const r = run(['Hello', ' there', '!']);
    expect(r.out).toBe('Hello there!');
    expect(r.endCall).toBe(false);
  });

  it('strips the sentinel when it arrives in one chunk', () => {
    const r = run(['Bye now. ', END_CALL_TOKEN]);
    expect(r.out).toBe('Bye now. ');
    expect(r.endCall).toBe(true);
  });

  it('never speaks a sentinel split across chunks', () => {
    const r = run(['Goodbye! ', '[EN', 'D_C', 'ALL]', ' trailing']);
    expect(r.out).toBe('Goodbye! ');
    expect(r.endCall).toBe(true);
  });

  it('releases a false-start bracket once it is clearly not the sentinel', () => {
    const r = run(['Press [', 'one] to continue']);
    expect(r.out).toBe('Press [one] to continue');
    expect(r.endCall).toBe(false);
  });

  it('flushes held-back text at end of stream', () => {
    const r = run(['See you [']);
    expect(r.out).toBe('See you [');
  });
});
