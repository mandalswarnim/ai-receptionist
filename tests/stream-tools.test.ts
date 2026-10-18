import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BusinessProfile } from '../src/services/business.service';
import type { ConversationState } from '../src/types';

const mocks = vi.hoisted(() => ({
  config: {
    OPENAI_API_KEY: 'sk-test',
    OPENAI_MODEL: 'gpt-4.1-mini',
    LLM_TIMEOUT_MS: 8000,
    RECORD_CALLS: true,
    COMPANY_TIMEZONE: 'Europe/London',
  },
  create: vi.fn(),
  enabled: vi.fn(),
  runTool: vi.fn(),
}));

vi.mock('../src/config', () => ({ config: mocks.config }));
vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.create } };
  },
}));
vi.mock('../src/services/appointment.service', () => ({
  appointmentsEnabled: mocks.enabled,
  runTool: mocks.runTool,
  promptSection: () => '\n\nBooking appointments: ...',
  TOOLS: [{ type: 'function', function: { name: 'check_availability' } }],
}));

import { streamResponse } from '../src/services/ai.service';

type Chunk = { choices: Array<{ delta: Record<string, unknown> }> };

function stream(chunks: Chunk[]) {
  return {
    controller: { abort: vi.fn() },
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
}

const text = (content: string): Chunk => ({ choices: [{ delta: { content } }] });
const toolCall = (id: string, name: string, args: string): Chunk => ({
  choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args } }] } }],
});

const BUSINESS: BusinessProfile = {
  id: 'biz-1',
  slug: 'acme',
  name: 'Acme Physio',
  mode: 'LIVE',
  personaName: 'Maya',
  greeting: null,
  openingHours: null,
  address: null,
  bookingSystem: null,
  bookingInstructions: null,
  menuNotes: null,
  faqs: [],
  notifyEmail: null,
  calendlyEventType: 'https://api.calendly.com/event_types/ABC',
};

const STATE: ConversationState = {
  callSid: 'CA1',
  from: '+447700900123',
  business: BUSINESS,
  step: 'collect_name',
  collectedInfo: {},
  turnCount: 1,
  turns: [{ role: 'caller', content: 'Can I book in for Tuesday?' }],
  startedAt: new Date(),
  silentPrompts: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
});

describe('streamResponse with appointment tools', () => {
  it('speaks, runs the tool, then speaks the answer', async () => {
    mocks.create
      .mockResolvedValueOnce(stream([text('Let me just check the diary.'), toolCall('call_1', 'check_availability', '{"from_date":"2026-10-20","to_date":null}')]))
      .mockResolvedValueOnce(stream([text('I can do two or three on Tuesday.')]));
    mocks.runTool.mockResolvedValue('Open times: ...');

    const tokens: string[] = [];
    const out = await streamResponse(STATE, (t) => tokens.push(t));

    expect(mocks.runTool).toHaveBeenCalledWith(STATE, 'check_availability', '{"from_date":"2026-10-20","to_date":null}');
    expect(out).toEqual({ fullText: 'Let me just check the diary. I can do two or three on Tuesday.', endCall: false });
    expect(tokens.join('')).toBe(out.fullText);

    const second = mocks.create.mock.calls[1][0];
    expect(second.messages.slice(-2)).toEqual([
      {
        role: 'assistant',
        content: 'Let me just check the diary.',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'check_availability', arguments: '{"from_date":"2026-10-20","to_date":null}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'Open times: ...' },
    ]);
    expect(second.messages[0].content).toContain('Booking appointments');
  });

  it('stops offering tools after three rounds so the caller always gets an answer', async () => {
    for (let i = 0; i < 3; i++) mocks.create.mockResolvedValueOnce(stream([toolCall(`c${i}`, 'check_availability', '{}')]));
    mocks.create.mockResolvedValueOnce(stream([text('Sorry, the diary is playing up.')]));
    mocks.runTool.mockResolvedValue('error');

    const out = await streamResponse(STATE, () => {});

    expect(mocks.create).toHaveBeenCalledTimes(4);
    expect(mocks.create.mock.calls.map((c) => c[0].tool_choice)).toEqual(['auto', 'auto', 'auto', 'none']);
    expect(out.fullText).toBe('Sorry, the diary is playing up.');
  });

  it('sends no tools for a business without appointments', async () => {
    mocks.enabled.mockReturnValue(false);
    mocks.create.mockResolvedValueOnce(stream([text('Could I take your name?')]));

    const out = await streamResponse(STATE, () => {});

    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('tools');
    expect(mocks.create.mock.calls[0][0].messages[0].content).not.toContain('Booking appointments');
    expect(out.fullText).toBe('Could I take your name?');
  });
});
