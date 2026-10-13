import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  config: {
    SMTP_HOST: 'smtp.test',
    SMTP_PORT: '587',
    SMTP_USER: 'bot@test.dev',
    SMTP_PASS: 'x',
    EMAIL_FROM_NAME: 'AI Receptionist',
    BUSINESS_EMAIL: 'swarnim@test.dev',
    COMPANY_TIMEZONE: 'Europe/London',
  },
}));

vi.mock('../src/config', () => ({ config: mocks.config }));
vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({ sendMail: mocks.sendMail, verify: () => Promise.resolve() }),
  },
}));

import { sendCallSummaryEmail, summaryRecipient } from '../src/services/email.service';

const data = {
  name: 'James',
  company: '',
  phone: '+447700900123',
  email: '',
  message: 'Table for 4 on Friday at 7pm.',
  urgency: 'medium' as const,
  summary: 'James booked a table for 4 on Friday at 7pm.',
};
const when = new Date('2026-10-13T13:00:00Z');

beforeEach(() => {
  mocks.sendMail.mockReset().mockResolvedValue({});
});

describe('call summary email', () => {
  it('LIVE goes to the business with the usual subject', async () => {
    await sendCallSummaryEmail(data, 'CA1', when, {
      name: 'Acme',
      mode: 'LIVE',
      notifyEmail: 'owner@acme.test',
    });

    const mail = mocks.sendMail.mock.calls[0][0];
    expect(mail.to).toBe('owner@acme.test');
    expect(mail.subject).toBe('New Missed Call Message from James');
    expect(mail.text).toContain('NEW MISSED CALL MESSAGE — Acme');
  });

  it('DEMO never emails the prospect and is marked as a demo', async () => {
    await sendCallSummaryEmail(data, 'CA1', when, {
      name: 'The Crown',
      mode: 'DEMO',
      notifyEmail: 'landlord@thecrown.test',
    });

    const mail = mocks.sendMail.mock.calls[0][0];
    expect(mail.to).toBe('swarnim@test.dev');
    expect(mail.subject).toBe('Demo call: The Crown — James');
    expect(mail.html).toContain('Demo call — The Crown');
  });

  it('LIVE without its own address falls back to BUSINESS_EMAIL', () => {
    expect(summaryRecipient({ name: 'Acme', mode: 'LIVE', notifyEmail: null })).toBe('swarnim@test.dev');
  });

  it('escapes the business name in the HTML', async () => {
    await sendCallSummaryEmail(data, 'CA1', when, { name: 'Fish & <Chips>', mode: 'DEMO', notifyEmail: null });
    expect(mocks.sendMail.mock.calls[0][0].html).toContain('Fish &amp; &lt;Chips&gt;');
  });
});
