import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../src/lib/html';

describe('escapeHtml', () => {
  it('neutralises markup from caller-derived text', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'q'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;'
    );
  });
});
