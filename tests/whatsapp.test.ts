import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtractedCallData } from '../src/types';

const mocks = vi.hoisted(() => ({
  config: {
    TWILIO_WHATSAPP_FROM: '+447700900000' as string | undefined,
    TWILIO_WHATSAPP_TEMPLATE_SID: 'HX123' as string | undefined,
  },
  create: vi.fn(),
}));

vi.mock('../src/config', () => ({ config: mocks.config }));
vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/services/twilio.service', () => ({
  twilioClient: { messages: { create: mocks.create } },
}));

import { sendWhatsAppSummary, summaryChannels, templateVariables } from '../src/services/whatsapp.service';
import { hasFeature, tiersWith } from '../src/lib/tiers';

const READY = {
  mode: 'LIVE' as const,
  tier: 'ARISTEIA' as const,
  notifyChannel: 'WHATSAPP' as const,
  whatsappNumbers: ['+447700900111'],
  whatsappOptInAt: new Date('2026-10-01'),
};

const DATA: ExtractedCallData = {
  name: 'James Smith',
  company: '',
  phone: '+447700900123',
  email: '',
  message: 'Wants a table for 4\non Friday at 7pm.',
  urgency: 'high',
  summary: 'James wants to book.',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.TWILIO_WHATSAPP_FROM = '+447700900000';
  mocks.config.TWILIO_WHATSAPP_TEMPLATE_SID = 'HX123';
  mocks.create.mockResolvedValue({ sid: 'SM1' });
});

describe('tiers', () => {
  it('gives WhatsApp to the top two tiers only', () => {
    expect(['AGATHOS', 'ARETE', 'ARISTEIA', 'AXIOM'].map((t) => hasFeature(t as never, 'whatsappAlerts'))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(tiersWith('whatsappAlerts')).toBe('Aristeia and Axiom');
  });
});

describe('summaryChannels', () => {
  it('follows the choice on a tier with WhatsApp', () => {
    expect(summaryChannels(READY)).toEqual({ email: false, whatsapp: true });
    expect(summaryChannels({ ...READY, notifyChannel: 'BOTH' })).toEqual({ email: true, whatsapp: true });
    expect(summaryChannels({ ...READY, notifyChannel: 'EMAIL' })).toEqual({ email: true, whatsapp: false });
  });

  it.each([
    ['a lower tier', { tier: 'ARETE' as const }],
    ['a demo business', { mode: 'DEMO' as const }],
    ['no numbers', { whatsappNumbers: [] }],
    ['no opt-in', { whatsappOptInAt: null }],
  ])('emails instead for %s', (_label, over) => {
    expect(summaryChannels({ ...READY, ...over })).toEqual({ email: true, whatsapp: false });
  });

  it('emails instead when WhatsApp is not set up', () => {
    mocks.config.TWILIO_WHATSAPP_TEMPLATE_SID = undefined;
    expect(summaryChannels(READY)).toEqual({ email: true, whatsapp: false });
  });
});

describe('templateVariables', () => {
  it('fills the template with single-line values', () => {
    expect(templateVariables(DATA, 'The Crown')).toEqual({
      '1': 'The Crown',
      '2': 'James Smith',
      '3': '+447700900123',
      '4': 'Wants a table for 4 on Friday at 7pm.',
      '5': 'High',
    });
  });

  it('never leaves a variable empty and caps long messages', () => {
    const vars = templateVariables({ ...DATA, name: '', phone: ' ', message: 'x'.repeat(2000) }, 'The Crown');
    expect(vars['2']).toBe('Unknown caller');
    expect(vars['3']).toBe('not given');
    expect(vars['4']).toHaveLength(900);
    expect(vars['4'].endsWith('…')).toBe(true);
  });
});

describe('sendWhatsAppSummary', () => {
  const business = { name: 'The Crown', whatsappNumbers: ['+447700900111', '+447700900222'] };

  it('sends the approved template to every number', async () => {
    await sendWhatsAppSummary(DATA, 'CA1', business);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledWith({
      from: 'whatsapp:+447700900000',
      to: 'whatsapp:+447700900111',
      contentSid: 'HX123',
      contentVariables: JSON.stringify(templateVariables(DATA, 'The Crown')),
    });
  });

  it('succeeds if any number got it', async () => {
    mocks.create.mockRejectedValueOnce(new Error('63016'));
    await expect(sendWhatsAppSummary(DATA, 'CA1', business)).resolves.toBeUndefined();
  });

  it('fails if no number got it', async () => {
    mocks.create.mockRejectedValue(new Error('63016'));
    await expect(sendWhatsAppSummary(DATA, 'CA1', business)).rejects.toThrow('63016');
  });
});
