import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConversationState } from '../src/types';
import type { BusinessProfile } from '../src/services/business.service';

const LIVE_BUSINESS: BusinessProfile = {
  id: 'biz-default',
  slug: 'default',
  name: 'Acme',
  mode: 'LIVE',
  personaName: 'Maya',
  greeting: null,
  openingHours: null,
  address: null,
  bookingSystem: null,
  bookingInstructions: null,
  menuNotes: null,
  faqs: [],
  notifyEmail: 'owner@acme.test',
  calendlyEventType: null,
};

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  config: {
    RECORD_CALLS: false,
    RECORDING_WAIT_MS: 0,
    TWILIO_PHONE_NUMBER: '+15550000000',
    BASE_URL: 'https://reception.test',
  },
  extract: vi.fn(),
  sendEmail: vi.fn(),
  appendCallLog: vi.fn(),
}));

vi.mock('../src/config', () => ({ config: mocks.config }));
vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/lib/db', () => ({
  db: {
    call: {
      upsert: mocks.upsert,
      update: mocks.update,
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
  },
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
// A stored business stands in for its own profile; older calls get the default
vi.mock('../src/services/sheets.service', () => ({
  getSheets: () => ({ appendCallLog: mocks.appendCallLog }),
}));
vi.mock('../src/services/business.service', () => ({
  profileForCall: async (business: BusinessProfile | null) => business ?? LIVE_BUSINESS,
}));

import {
  processCompletedCall,
  resendPendingEmails,
  finishCall,
  runPostCall,
  drainPostCallTasks,
  pendingPostCallCount,
} from '../src/services/call.service';

function state(): ConversationState {
  return {
    callSid: 'CA123',
    from: '+447700900123',
    business: LIVE_BUSINESS,
    step: 'closing',
    collectedInfo: {},
    turnCount: 2,
    turns: [
      { role: 'assistant', content: 'Hi, could I take your name?' },
      { role: 'caller', content: "It's James, calling about my invoice." },
    ],
    startedAt: new Date('2026-09-01T10:00:00Z'),
    silentPrompts: 0,
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
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.appendCallLog.mockResolvedValue(2);
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

  it('states an appointment booked on the call at the top of the message', async () => {
    const booked = {
      startTime: '2026-10-20T13:00:00.000Z',
      label: 'Tuesday 20 October at 2:00 pm',
      name: 'James Smith',
      email: 'james@example.com',
      eventUri: 'https://api.calendly.com/scheduled_events/EV1',
    };

    await processCompletedCall({ ...state(), appointment: { offered: [], booked } });

    expect(mocks.sendEmail.mock.calls[0][0].message).toBe(
      'Appointment booked in Calendly for Tuesday 20 October at 2:00 pm (James Smith, james@example.com). ' +
        'James is calling about his invoice.'
    );
  });

  it('links the call to its business and emails for that business', async () => {
    const demo = { ...LIVE_BUSINESS, id: 'biz-crown', name: 'The Crown', mode: 'DEMO' as const };

    await processCompletedCall({ ...state(), business: demo });

    expect(mocks.upsert.mock.calls[0][0].create.businessId).toBe('biz-crown');
    expect(mocks.sendEmail.mock.calls[0][3]).toBe(demo);
  });

  it('adds a finished demo call to the Call Log with its summary and transcript link', async () => {
    const demo = { ...LIVE_BUSINESS, id: 'biz-crown', name: 'The Crown', mode: 'DEMO' as const };

    await processCompletedCall({ ...state(), business: demo });

    expect(mocks.appendCallLog).toHaveBeenCalledWith({
      date: new Date('2026-09-01T10:00:00Z'),
      pubName: 'The Crown',
      aiDemoUsed: true,
      notes: 'AI demo: James called about an invoice. Transcript: https://reception.test/api/calls/call-1/transcript',
    });
  });

  it('never puts real customer calls in the sales sheet', async () => {
    await processCompletedCall(state());
    expect(mocks.appendCallLog).not.toHaveBeenCalled();
  });

  it('a Sheets failure does not affect the email', async () => {
    mocks.appendCallLog.mockRejectedValue(new Error('403 The caller does not have permission'));
    const demo = { ...LIVE_BUSINESS, mode: 'DEMO' as const };

    await processCompletedCall({ ...state(), business: demo });

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailSent: true }) })
    );
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
    business: null,
  };

  it('resends unsent emails and marks them sent', async () => {
    mocks.findMany.mockResolvedValue([row]);

    await resendPendingEmails();

    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'COMPLETED', emailSent: false, summary: { not: null } });
    expect(mocks.sendEmail.mock.calls[0][0]).toMatchObject({ name: 'James', urgency: 'high' });
    expect(mocks.sendEmail.mock.calls[0][3]).toBe(LIVE_BUSINESS);
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

describe('finishCall', () => {
  it('marks calls where the caller never spoke as NO_ANSWER without emailing', async () => {
    const silent = { ...state(), turns: [{ role: 'assistant' as const, content: 'Hello?' }] };

    finishCall(silent);
    await vi.waitFor(() => expect(mocks.updateMany).toHaveBeenCalled());

    expect(mocks.updateMany.mock.calls[0][0]).toMatchObject({
      where: { callSid: 'CA123' },
      data: { status: 'NO_ANSWER' },
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('uses no phone number when the caller ID is withheld', async () => {
    mocks.extract.mockResolvedValue({ ...extracted, phone: '' });

    await processCompletedCall({ ...state(), from: 'anonymous' });

    expect(mocks.sendEmail.mock.calls[0][0].phone).toBe('');
  });
});

// Must run last: draining puts the module into shutdown mode.
describe('drainPostCallTasks', () => {
  it('stops waiting for the recording and gets the email out', async () => {
    mocks.config.RECORD_CALLS = true;
    mocks.config.RECORDING_WAIT_MS = 60_000;

    runPostCall(state());
    expect(pendingPostCallCount()).toBe(1);

    await drainPostCallTasks(); // would hang for 60s if the wait weren't cut short

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(pendingPostCallCount()).toBe(0);
  });
});
