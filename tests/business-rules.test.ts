import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config', () => ({ config: {} }));
vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/lib/db', () => ({ db: {} }));
vi.mock('../src/api/middleware', () => ({ requireAdminKey: vi.fn() }));

import { checkRules, toData } from '../src/api/routes/businesses';

const WHATSAPP_READY = {
  mode: 'LIVE' as const,
  tier: 'AXIOM' as const,
  notifyChannel: 'WHATSAPP' as const,
  whatsappNumbers: ['+447700900111'],
  whatsappOptInAt: new Date(),
};

describe('WhatsApp summary rules', () => {
  it('allows WhatsApp on a top tier with numbers and an opt-in', () => {
    expect(checkRules('the-crown', WHATSAPP_READY)).toBeUndefined();
  });

  it('refuses WhatsApp on a lower tier', () => {
    expect(checkRules('the-crown', { ...WHATSAPP_READY, tier: 'ARETE' })).toBe(
      'WhatsApp summaries are on Aristeia and Axiom; this business is on ARETE'
    );
  });

  it('needs numbers and an opt-in, and never for a demo', () => {
    expect(checkRules('x', { ...WHATSAPP_READY, whatsappNumbers: [] })).toMatch(/whatsappNumbers/);
    expect(checkRules('x', { ...WHATSAPP_READY, whatsappOptInAt: null })).toMatch(/opt-in/);
    expect(checkRules('x', { ...WHATSAPP_READY, mode: 'DEMO' })).toBe('Demo call summaries are only emailed');
  });

  it('email needs nothing extra on any tier', () => {
    expect(checkRules('x', { mode: 'LIVE', tier: 'AGATHOS', notifyChannel: 'EMAIL' })).toBeUndefined();
  });
});

describe('opt-in', () => {
  it('records the opt-in time', () => {
    expect(toData({ whatsappNumbers: ['+447700900111'], whatsappOptIn: true }).whatsappOptInAt).toBeInstanceOf(Date);
  });

  it('clears it when the numbers change without a fresh opt-in', () => {
    const data = toData({ whatsappNumbers: ['+447700900222'] }, { whatsappNumbers: ['+447700900111'] });
    expect(data).toEqual({ whatsappNumbers: ['+447700900222'], whatsappOptInAt: null });
  });

  it('keeps it when the numbers are unchanged or not sent', () => {
    expect(toData({ whatsappNumbers: ['+447700900111'] }, { whatsappNumbers: ['+447700900111'] })).not.toHaveProperty('whatsappOptInAt');
    expect(toData({ name: 'The Crown' }, { whatsappNumbers: ['+447700900111'] })).toEqual({ name: 'The Crown' });
  });

  it('withdraws it on request', () => {
    expect(toData({ whatsappOptIn: false }).whatsappOptInAt).toBeNull();
  });
});
