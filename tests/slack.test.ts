import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config', () => ({ config: {} }));
vi.mock('../src/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import { escapeSlack } from '../src/services/slack.service';

describe('escapeSlack', () => {
  it('neutralises mentions and links', () => {
    expect(escapeSlack('<!channel> & <http://evil|click>')).toBe(
      '&lt;!channel&gt; &amp; &lt;http://evil|click&gt;'
    );
  });
});
