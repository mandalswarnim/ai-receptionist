import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConversationState } from '../src/types';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
  extract: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('../src/config', () => ({
  config: {
    RECORD_CALLS: false,
    RECORDING_WAIT_MS: 0,
    TWILIO_PHONE_NUMBER: '+15550000000',
  },
}));
vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/lib/db', () => ({
  db: { call: { upsert: mocks.upsert, update: mocks.update, findMany: mocks.findMany } },
}));
vi.mock('../src/lib/retry', () => ({
  // Same semantics, no real delays
  withRetry: async <T>(fn: () => Promise<T>, opts: { attempts?: number } = {}) => {
    let last: unknown;
    for (let i = 0; i < (opts.attempts ?? 3); i++) {
      try {
        return await fn();
      } catch (err) {
        last = err;
      }
    }
    throw last;
  },
}));
vi.mock('../src/services/transcription.service', () => ({
  transcribeRecording: vi.fn(),
  buildTurnsTranscript: (turns: Array<{ role: string; content: string }>) =>
    turns.map((t) => `${t.role}: ${t.content}`).join('\n'),
}));
vi.mock('../src/services/ai.service', async () => ({
  extractStructuredData: mocks.extract,
  normalizeUrgency: (await import('../src/lib/urgency')).normalizeUrgency,
}));
vi.mock('../src/services/email.service', () => ({ sendCallSummaryEmail: mocks.sendEmail }));
vi.mock('../src/services/slack.service', () => ({ sendSlackNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/services/twilio.service', () => ({ sendUrgentSms: vi.fn() }));

import { processCompletedCall, resendPendingEmails } from '../src/services/call.service';

function state(): ConversationState {
  return {
    callSid: 'CA123',
    from: '+447700900123',
    step: 'closing',
    collectedInfo: {},
    turnCount: 2,
    turns: [
      { role: 'assistant', content: 'Hi, could I take your name?' },
      { role: 'caller', content: "It's James, calling about my invoice." },
    ],
    startedAt: new Date('2026-09-01T10:00:00Z'),
    confirmed: false,
  };
}

const extracted = {
  name: 'James',
  company: '',
  phone: '+447700900123',
  email: '',
  message: 'James is calling about his invoice.',
  urgency: 'medium' as const,
  summary: 'James called about an invoice.',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsert.mockResolvedValue({ id: 'call-1' });
  mocks.update.mockResolvedValue({});
  mocks.extract.mockResolvedValue(extracted);
  mocks.sendEmail.mockResolvedValue(undefined);
});

describe('processCompletedCall', () => {
  it('writes the conversation turns on the update path, replacing old ones', async () => {
    await processCompletedCall(state());

    const args = mocks.upsert.mock.calls[0][0];
    const expectedTurns = [
      { role: 'assistant', content: 'Hi, could I take your name?', sequence: 0 },
      { role: 'caller', content: "It's James, calling about my invoice.", sequence: 1 },
    ];
    expect(args.update.turns).toEqual({ deleteMany: {}, create: expectedTurns });
    expect(args.create.turns).toEqual({ create: expectedTurns });
  });

  it('still emails a transcript-based summary when extraction fails', async () => {
    mocks.extract.mockRejectedValue(new Error('OpenAI down'));

    await processCompletedCall(state());

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const data = mocks.sendEmail.mock.calls[0][0];
    expect(data.summary).toContain('could not be generated');
    expect(data.summary).toContain('calling about my invoice');
    expect(data.phone).toBe('+447700900123');
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailSent: true }) })
    );
  });

  it('retries the email and marks it sent once it goes through', async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error('SMTP 421')).mockResolvedValue(undefined);

    await processCompletedCall(state());

    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailSent: true }) })
    );
  });

  it('leaves the call COMPLETED with emailSent=false when every email attempt fails', async () => {
    mocks.sendEmail.mockRejectedValue(new Error('SMTP down'));

    await processCompletedCall(state());

    expect(mocks.sendEmail).toHaveBeenCalledTimes(3);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert.mock.calls[0][0].update.status).toBe('COMPLETED');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('still sends the email when saving the call fails', async () => {
    mocks.upsert.mockRejectedValue(new Error('db down'));

    await processCompletedCall(state());

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe('resendPendingEmails', () => {
  const row = {
    id: 'call-1',
    callSid: 'CA123',
    from: '+447700900123',
    startedAt: new Date('2026-09-01T10:00:00Z'),
    callerName: 'James',
    callerCompany: null,
    callerPhone: '+447700900123',
    callerEmail: null,
    message: 'About an invoice.',
    urgency: 'HIGH',
    summary: 'James called about an invoice.',
  };

  it('resends unsent emails and marks them sent', async () => {
    mocks.findMany.mockResolvedValue([row]);

    await resendPendingEmails();

    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'COMPLETED', emailSent: false, summary: { not: null } });
    expect(mocks.sendEmail.mock.calls[0][0]).toMatchObject({ name: 'James', urgency: 'high' });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'call-1' },
      data: expect.objectContaining({ emailSent: true }),
    });
  });

  it('stops the sweep on the first failure', async () => {
    mocks.findMany.mockResolvedValue([row, { ...row, id: 'call-2', callSid: 'CA456' }]);
    mocks.sendEmail.mockRejectedValue(new Error('SMTP down'));

    await resendPendingEmails();

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
