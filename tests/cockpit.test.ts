import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Prospect } from '../src/services/sheets.service';

const mocks = vi.hoisted(() => {
  const participantOps = { update: vi.fn(), remove: vi.fn() };
  const participants = Object.assign(
    vi.fn(() => participantOps),
    { create: vi.fn() }
  );
  const conferenceOps = { participants, update: vi.fn() };
  const callOps = { update: vi.fn(), recordings: { create: vi.fn() } };
  return {
    config: {
      BASE_URL: 'https://reception.test',
      TWILIO_PHONE_NUMBER: '+441000000000',
      AGENT_PHONE_NUMBER: '+447999999999' as string | undefined,
      TWILIO_DEMO_APP_SID: 'APdemo' as string | undefined,
      CALLING_HOURS: undefined as string | undefined,
      RECORD_SALES_CALLS: false,
      TTS_VOICE: 'Polly.Amy',
      TTS_LANGUAGE: 'en-GB',
      PERSONA_NAME: 'Maya',
    },
    twilio: {
      calls: Object.assign(vi.fn(() => callOps), { create: vi.fn() }),
      conferences: vi.fn(() => conferenceOps),
    },
    callOps,
    conferenceOps,
    participants,
    participantOps,
    sheets: {
      findProspect: vi.fn(),
      getDoNotCall: vi.fn(),
      updateProspectStatus: vi.fn(),
      appendCallLog: vi.fn(),
      appendDoNotCall: vi.fn(),
    },
    business: { findUnique: vi.fn() },
    call: { findUnique: vi.fn() },
  };
});

vi.mock('../src/config', () => ({ config: mocks.config }));
vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/lib/db', () => ({ db: { business: mocks.business, call: mocks.call } }));
vi.mock('../src/services/twilio.service', () => ({ twilioClient: mocks.twilio }));
vi.mock('../src/services/sheets.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/sheets.service')>()),
  getSheets: () => mocks.sheets,
}));
vi.mock('../src/services/demo-builder.service', () => ({
  slugify: (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
}));

import * as cockpit from '../src/services/cockpit.service';
import { claimCockpitDemo, takeCockpitCall } from '../src/services/demo.service';

// Tuesday 14 Oct 2026, 15:00 UK (BST)
const IN_HOURS = new Date('2026-10-14T14:00:00Z');

const prospect = (over: Partial<Prospect> = {}): Prospect => ({
  row: 2,
  pubName: 'The Swan',
  area: 'Marlow',
  address: '',
  phone: '01628 000000',
  website: '',
  contactName: '',
  contactRole: '',
  bookingSystem: '',
  researchNotes: '',
  bestTimeToCall: '',
  status: 'Not called',
  nextActionDate: '',
  timesCalled: '0',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: IN_HOURS, toFake: ['Date'] });
  cockpit._resetForTests();
  mocks.config.AGENT_PHONE_NUMBER = '+447999999999';
  mocks.config.TWILIO_DEMO_APP_SID = 'APdemo';
  mocks.config.RECORD_SALES_CALLS = false;
  mocks.sheets.findProspect.mockResolvedValue(prospect());
  mocks.sheets.getDoNotCall.mockResolvedValue([]);
  mocks.sheets.updateProspectStatus.mockResolvedValue(undefined);
  mocks.sheets.appendCallLog.mockResolvedValue(7);
  mocks.sheets.appendDoNotCall.mockResolvedValue(3);
  mocks.twilio.calls.create.mockResolvedValue({ sid: 'CA_AGENT' });
  mocks.participants.create.mockImplementation(async ({ label }: { label: string }) => ({
    callSid: label === 'pub' ? 'CA_PUB' : 'CA_AI',
  }));
  mocks.business.findUnique.mockResolvedValue({ id: 'biz-swan', name: 'The Swan', mode: 'DEMO' });
});

/** Runs a call up to "connected": agent pressed 1, conference started, pub answered. */
async function connectedCall() {
  const s = await cockpit.startCall('The Swan');
  await cockpit.agentConnectTwiml(s, '1');
  await cockpit.onConferenceEvent(s, { StatusCallbackEvent: 'conference-start', ConferenceSid: 'CF1' });
  cockpit.onLegStatus(s, 'pub', 'in-progress');
  return s;
}

describe('checkCanDial', () => {
  it('refuses outside calling hours', async () => {
    await expect(cockpit.checkCanDial('The Swan', new Date('2026-10-18T12:00:00Z'))).rejects.toThrow('Outside calling hours');
  });

  it('refuses a number on the Do Not Call tab, however it is written', async () => {
    mocks.sheets.getDoNotCall.mockResolvedValue([{ pubName: 'x', phone: '+44 1628 000000', dateAdded: '', reason: '', howTheyAsked: '' }]);
    await expect(cockpit.checkCanDial('The Swan', IN_HOURS)).rejects.toThrow('Do Not Call');
  });

  it('refuses a prospect marked "Do not call"', async () => {
    mocks.sheets.findProspect.mockResolvedValue(prospect({ status: 'Do not call' }));
    await expect(cockpit.checkCanDial('The Swan', IN_HOURS)).rejects.toThrow('marked "Do not call"');
  });

  it('refuses a number that is not a UK number', async () => {
    mocks.sheets.findProspect.mockResolvedValue(prospect({ phone: '12345' }));
    await expect(cockpit.checkCanDial('The Swan', IN_HOURS)).rejects.toThrow("doesn't look like a UK phone number");
  });

  it('returns the number to dial in E.164', async () => {
    expect((await cockpit.checkCanDial('The Swan', IN_HOURS)).e164).toBe('+441628000000');
  });
});

describe('a cockpit call', () => {
  it('rings your phone first and does not dial the pub', async () => {
    await cockpit.startCall('The Swan');

    expect(mocks.twilio.calls.create).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+447999999999', from: '+441000000000' })
    );
    expect(mocks.participants.create).not.toHaveBeenCalled();
    expect(mocks.sheets.updateProspectStatus).toHaveBeenCalledWith('The Swan', 'Calling');
  });

  it('needs AGENT_PHONE_NUMBER', async () => {
    mocks.config.AGENT_PHONE_NUMBER = undefined;
    await expect(cockpit.startCall('The Swan')).rejects.toThrow('AGENT_PHONE_NUMBER');
  });

  it('does not dial when anything but 1 is pressed (e.g. voicemail)', async () => {
    const s = await cockpit.startCall('The Swan');
    const twiml = await cockpit.agentConnectTwiml(s, undefined);

    expect(twiml).not.toContain('<Conference');
    expect(s.stage).toBe('ended');
  });

  it('re-checks Do Not Call at the moment of dialling', async () => {
    const s = await cockpit.startCall('The Swan');
    mocks.sheets.getDoNotCall.mockResolvedValue([{ pubName: 'The Swan', phone: '01628 000000', dateAdded: '', reason: '', howTheyAsked: '' }]);

    const twiml = await cockpit.agentConnectTwiml(s, '1');

    expect(twiml).not.toContain('<Conference');
    expect(s.stage).toBe('ended');
  });

  it('dials the pub from our number once you are in the conference', async () => {
    const s = await cockpit.startCall('The Swan');
    const twiml = await cockpit.agentConnectTwiml(s, '1');
    expect(twiml).toContain(`<Conference`);
    expect(mocks.participants.create).not.toHaveBeenCalled();

    await cockpit.onConferenceEvent(s, { StatusCallbackEvent: 'conference-start', ConferenceSid: 'CF1' });

    expect(mocks.participants.create).toHaveBeenCalledWith(
      expect.objectContaining({ from: '+441000000000', to: '+441628000000', label: 'pub' })
    );
  });

  it('hangs up when the pub does not answer', async () => {
    const s = await cockpit.startCall('The Swan');
    await cockpit.agentConnectTwiml(s, '1');
    await cockpit.onConferenceEvent(s, { StatusCallbackEvent: 'conference-start', ConferenceSid: 'CF1' });

    cockpit.onLegStatus(s, 'pub', 'no-answer');
    await vi.waitFor(() => expect(mocks.conferenceOps.update).toHaveBeenCalledWith({ status: 'completed' }));
    expect(s.stage).toBe('ended');
  });

  it('refuses a second call while one is in progress or unlogged', async () => {
    const s = await cockpit.startCall('The Swan');
    await expect(cockpit.startCall('The Swan')).rejects.toThrow('already in progress');
    cockpit.onLegStatus(s, 'agent', 'completed');
    await expect(cockpit.startCall('The Swan')).rejects.toThrow('Log or discard');
  });
});

describe('bringing in the demo', () => {
  it('mutes you and adds the demo app, which then answers as the pub', async () => {
    const s = await connectedCall();

    await cockpit.bringInDemo();

    expect(mocks.participantOps.update).toHaveBeenCalledWith({ muted: true });
    expect(mocks.participants.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: 'app:APdemo', from: '+441000000000', label: 'ai', endConferenceOnExit: false })
    );
    // The demo leg arriving at the incoming-call webhook claims the pub
    expect(claimCockpitDemo('CA_INBOUND')).toBe('biz-swan');
    expect(s.ai.inboundCallSid).toBe('CA_INBOUND');
    expect(takeCockpitCall('CA_INBOUND')).toBe(true);
    // ...and only once
    expect(claimCockpitDemo('CA_OTHER')).toBeUndefined();
  });

  it('falls back to dialling our own number without a demo app', async () => {
    mocks.config.TWILIO_DEMO_APP_SID = undefined;
    await connectedCall();
    await cockpit.bringInDemo();
    expect(mocks.participants.create).toHaveBeenLastCalledWith(expect.objectContaining({ to: '+441000000000' }));
  });

  it('needs a demo for the pub', async () => {
    mocks.business.findUnique.mockResolvedValue(null);
    await connectedCall();
    await expect(cockpit.bringInDemo()).rejects.toThrow('build it first');
    expect(mocks.participants.create).toHaveBeenCalledTimes(1); // just the pub
  });

  it('never uses a LIVE business as the demo', async () => {
    mocks.business.findUnique.mockResolvedValue({ id: 'biz-live', name: 'The Swan', mode: 'LIVE' });
    await connectedCall();
    await expect(cockpit.bringInDemo()).rejects.toThrow('build it first');
  });

  it('remove takes the AI off and unmutes you', async () => {
    const s = await connectedCall();
    await cockpit.bringInDemo();

    await cockpit.removeDemo();

    expect(mocks.participantOps.remove).toHaveBeenCalled();
    expect(mocks.participantOps.update).toHaveBeenLastCalledWith({ muted: false });
    expect(s.ai.state).toBe('off');
  });
});

describe('recording', () => {
  it('is refused unless RECORD_SALES_CALLS is on', async () => {
    await connectedCall();
    await expect(cockpit.startRecording()).rejects.toThrow('RECORD_SALES_CALLS');
    mocks.config.RECORD_SALES_CALLS = true;
    await cockpit.startRecording();
    expect(mocks.callOps.recordings.create).toHaveBeenCalled();
  });
});

describe('saveOutcome', () => {
  async function endedCall(withDemo = false) {
    const s = await connectedCall();
    if (withDemo) {
      await cockpit.bringInDemo();
      claimCockpitDemo('CA_INBOUND');
    }
    cockpit.onLegStatus(s, 'agent', 'completed');
    return s;
  }

  it('waits until the call has ended', async () => {
    await connectedCall();
    await expect(cockpit.saveOutcome({ outcome: 'Interested' })).rejects.toThrow('Hang up');
  });

  it('writes the Call Log and moves the prospect on', async () => {
    await endedCall(true);
    mocks.call.findUnique.mockResolvedValue({ id: 'call-9' });
    const followUp = new Date('2026-10-20T12:00:00Z');

    const result = await cockpit.saveOutcome({
      outcome: 'Interested',
      spokeTo: 'Dave',
      reachedDecisionMaker: true,
      demoReaction: 5,
      followUpDate: followUp,
      notes: 'Wants trial details',
    });

    expect(result).toEqual({ callLogRow: 7, status: 'Lead' });
    expect(mocks.sheets.appendCallLog).toHaveBeenCalledWith(
      expect.objectContaining({
        pubName: 'The Swan',
        outcome: 'Interested',
        aiDemoUsed: true,
        demoReaction: 5,
        reachedDecisionMaker: true,
        notes: 'Wants trial details Demo transcript: https://reception.test/api/calls/call-9/transcript',
      })
    );
    expect(mocks.sheets.updateProspectStatus).toHaveBeenLastCalledWith('The Swan', 'Lead', followUp);
    expect(mocks.sheets.appendDoNotCall).not.toHaveBeenCalled();
    expect(cockpit.getSession()).toBeUndefined();
  });

  it('"Asked not to be called" adds them to Do Not Call and overrides the status', async () => {
    await endedCall();

    const result = await cockpit.saveOutcome({ outcome: 'Asked not to be called', status: 'Callback' });

    expect(result.status).toBe('Do not call');
    expect(mocks.sheets.appendDoNotCall).toHaveBeenCalledWith(
      expect.objectContaining({ pubName: 'The Swan', phone: '01628 000000', howTheyAsked: 'On a sales call' })
    );
  });

  it('leaves the demo reaction out when no demo was used', async () => {
    await endedCall();
    await cockpit.saveOutcome({ outcome: 'Not interested', demoReaction: 3 });
    expect(mocks.sheets.appendCallLog.mock.calls[0][0]).toMatchObject({ aiDemoUsed: false, demoReaction: undefined });
  });
});

describe('buildQueue', () => {
  const today = '2026-10-14';

  it('lists due callbacks first, then new prospects in sheet order', () => {
    const queue = cockpit.buildQueue(
      [
        prospect({ row: 2, pubName: 'New A' }),
        prospect({ row: 3, pubName: 'Later callback', status: 'Callback', nextActionDate: '2026-10-20' }),
        prospect({ row: 4, pubName: 'Old callback', status: 'Callback', nextActionDate: '01/10/2026' }),
        prospect({ row: 5, pubName: 'Lead', status: 'Lead' }),
        prospect({ row: 6, pubName: 'New B', status: '' }),
        prospect({ row: 7, pubName: 'Due callback', status: 'Callback', nextActionDate: '2026-10-14' }),
      ],
      [],
      today
    );
    expect(queue.map((p) => p.pubName)).toEqual(['Old callback', 'Due callback', 'New A', 'New B']);
  });

  it('shows but blocks numbers on Do Not Call or not dialable', () => {
    const queue = cockpit.buildQueue(
      [prospect({ pubName: 'Blocked', phone: '01628 111111' }), prospect({ row: 3, pubName: 'No phone', phone: '' })],
      [{ pubName: '', phone: '01628111111', dateAdded: '', reason: '', howTheyAsked: '' }],
      today
    );
    expect(queue.map((p) => p.blocked)).toEqual(['On Do Not Call', 'No valid UK phone number']);
  });

  it('parses ISO and UK sheet dates', () => {
    expect(cockpit.parseSheetDate('2026-10-20')).toBe('2026-10-20');
    expect(cockpit.parseSheetDate('5/9/2026')).toBe('2026-09-05');
    expect(cockpit.parseSheetDate('next week')).toBeUndefined();
  });
});
