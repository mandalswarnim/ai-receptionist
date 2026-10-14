/**
 * Calling cockpit: one sales call at a time, run from /cockpit.
 *
 *   1. Call     — Twilio rings AGENT_PHONE_NUMBER. Swarnim presses 1 to go on.
 *   2. Connect  — he joins a named conference; when it starts, the pub is
 *                 dialled into it from our Twilio number (never withheld).
 *   3. Demo     — "Bring in demo" adds the demo receptionist as a participant,
 *                 answering as that pub. Swarnim is muted so the AI can't hear
 *                 him; he unmutes to take over. "Remove AI" takes it out.
 *   4. Outcome  — after hang-up, the form writes Call Log, updates Prospects
 *                 and, when asked, adds the number to Do Not Call.
 *
 * Legal guard rails (PECR): a human starts every call, the pub is only
 * dialled after Swarnim confirms on his own phone, and the Do Not Call tab,
 * the prospect's status and the calling hours are checked in code first —
 * again at the moment of dialling.
 */

import { randomUUID } from 'crypto';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import { config } from '../config';
import { db } from '../lib/db';
import { logger } from '../lib/logger';
import { toUkE164 } from '../lib/phone';
import { DEFAULT_CALLING_HOURS, isWithinCallingHours } from '../lib/calling-hours';
import { twilioClient } from './twilio.service';
import {
  CallOutcome,
  CALL_OUTCOMES,
  getSheets,
  isOnDoNotCall,
  Prospect,
  PROSPECT_STATUSES,
  ProspectStatus,
  SheetsService,
} from './sheets.service';
import { slugify } from './demo-builder.service';
import { cancelCockpitDemo, expectCockpitDemo } from './demo.service';

// ─── Types ───────────────────────────────────────────────────────────────────

export type LegState =
  | 'idle'
  | 'queued'
  | 'initiated'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'no-answer'
  | 'failed'
  | 'canceled';

export type Stage = 'calling-you' | 'waiting-for-you' | 'dialling-pub' | 'connected' | 'ended';

export interface CockpitSession {
  id: string;
  conferenceName: string;
  conferenceSid?: string;
  prospect: { row: number; pubName: string; phone: string; e164: string };
  startedAt: Date;
  stage: Stage;
  agent: { callSid?: string; state: LegState; muted: boolean };
  pub: { callSid?: string; state: LegState; answeredAt?: Date };
  ai: { callSid?: string; state: 'off' | 'joining' | 'on'; inboundCallSid?: string; used: boolean };
  recording: boolean;
  endedAt?: Date;
  events: Array<{ at: Date; text: string }>;
}

export class CockpitError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

// ─── Outcome → prospect status ───────────────────────────────────────────────

/** What a call outcome usually means for the prospect; the form can override it. */
export const DEFAULT_STATUS_FOR_OUTCOME: Record<CallOutcome, ProspectStatus> = {
  'No answer': 'Callback',
  Gatekeeper: 'Callback',
  'Call back later': 'Callback',
  Interested: 'Lead',
  'Not interested': 'Not interested',
  'Asked not to be called': 'Do not call',
};

// ─── Queue ───────────────────────────────────────────────────────────────────

/**
 * A sheet date as yyyy-mm-dd. Reads ISO ("2026-10-20") and UK ("20/10/2026")
 * formats; undefined for anything else.
 */
export function parseSheetDate(value: string): string | undefined {
  const v = value.trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return undefined;
}

export interface QueueItem extends Prospect {
  /** Why it's in the queue (or why not, for blocked ones). */
  reason: string;
  blocked?: string;
}

/**
 * Prospects to call today: Status "Not called" or "Callback" (or blank), with
 * no Next action date or one that's due. Callbacks come first, oldest date
 * first, then new prospects in sheet order. Anything on Do Not Call is
 * listed as blocked so it's visible but can't be dialled.
 */
export function buildQueue(prospects: Prospect[], doNotCall: Parameters<typeof isOnDoNotCall>[1], today: string): QueueItem[] {
  const items: Array<QueueItem & { sortKey: string }> = [];
  for (const p of prospects) {
    if (!['Not called', 'Callback', ''].includes(p.status)) continue;
    const due = p.nextActionDate ? parseSheetDate(p.nextActionDate) : undefined;
    // An unreadable date isn't hidden: better to show it than lose a callback
    if (due && due > today) continue;
    const isCallback = p.status === 'Callback';
    const blocked = isOnDoNotCall(p.phone, doNotCall)
      ? 'On Do Not Call'
      : !toUkE164(p.phone)
        ? 'No valid UK phone number'
        : undefined;
    items.push({
      ...p,
      reason: isCallback ? (due ? `Callback due ${due}` : 'Callback') : 'Not called yet',
      blocked,
      sortKey: `${isCallback ? 0 : 1}-${isCallback ? (due ?? '0000') : String(p.row).padStart(6, '0')}`,
    });
  }
  return items.sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map(({ sortKey: _sortKey, ...item }) => item);
}

/** Today in the UK, yyyy-mm-dd. */
export function ukToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);
}

// ─── Pre-dial checks ─────────────────────────────────────────────────────────

const callingHours = () => config.CALLING_HOURS ?? DEFAULT_CALLING_HOURS;

export function callingWindowOpen(now = new Date()): boolean {
  return isWithinCallingHours(now, callingHours());
}

function requireSheets(): SheetsService {
  const sheets = getSheets();
  if (!sheets) throw new CockpitError('Google Sheets sync is off: set GOOGLE_SHEETS_ID and GOOGLE_SERVICE_ACCOUNT_JSON', 503);
  return sheets;
}

/**
 * Everything that must be true before a prospect may be dialled. Reads the
 * sheet fresh every time so a Do Not Call added a minute ago is respected.
 */
export async function checkCanDial(pubName: string, now = new Date()): Promise<{ prospect: Prospect; e164: string }> {
  const sheets = requireSheets();
  if (!callingWindowOpen(now)) {
    throw new CockpitError(`Outside calling hours (${callingHours()}, UK time)`);
  }
  const [prospect, doNotCall] = await Promise.all([sheets.findProspect(pubName), sheets.getDoNotCall()]);
  if (!prospect) throw new CockpitError(`"${pubName}" isn't in the Prospects tab`, 404);
  if (prospect.status === 'Do not call') throw new CockpitError(`${prospect.pubName} is marked "Do not call"`);
  if (isOnDoNotCall(prospect.phone, doNotCall)) {
    throw new CockpitError(`${prospect.phone} is on the Do Not Call list`);
  }
  const e164 = toUkE164(prospect.phone);
  if (!e164) throw new CockpitError(`"${prospect.phone}" doesn't look like a UK phone number`);
  return { prospect, e164 };
}

// ─── Session ─────────────────────────────────────────────────────────────────

let session: CockpitSession | undefined;

const DONE_STATES: LegState[] = ['completed', 'busy', 'no-answer', 'failed', 'canceled'];

function note(s: CockpitSession, text: string): void {
  s.events.push({ at: new Date(), text });
  logger.info('Cockpit: ' + text, { session: s.id });
}

function end(s: CockpitSession, why: string): void {
  if (s.stage === 'ended') return;
  s.stage = 'ended';
  s.endedAt = new Date();
  if (s.ai.state !== 'off') s.ai.state = 'off';
  cancelCockpitDemo();
  note(s, why);
}

export function getSession(): CockpitSession | undefined {
  return session;
}

/** The session a Twilio callback refers to, ignoring stale ones. */
export function sessionFor(id: string | undefined): CockpitSession | undefined {
  return id && session?.id === id ? session : undefined;
}

function requireLive(): CockpitSession {
  if (!session || session.stage === 'ended') throw new CockpitError('No call in progress', 409);
  return session;
}

const webhook = (path: string, s: CockpitSession, extra = '') =>
  `${config.BASE_URL}/api/webhooks/cockpit/${path}?session=${s.id}${extra}`;

const LEG_EVENTS = ['initiated', 'ringing', 'answered', 'completed'];

/** Step 1: ring Swarnim. The pub is dialled only after he presses 1. */
export async function startCall(pubName: string): Promise<CockpitSession> {
  if (!config.AGENT_PHONE_NUMBER) throw new CockpitError('Set AGENT_PHONE_NUMBER (your mobile) to use the cockpit', 503);
  if (session && session.stage !== 'ended') throw new CockpitError('A call is already in progress', 409);
  if (session) throw new CockpitError(`Log or discard the call to ${session.prospect.pubName} first`, 409);

  const { prospect, e164 } = await checkCanDial(pubName);

  const s: CockpitSession = {
    id: randomUUID(),
    conferenceName: `cockpit-${Date.now()}`,
    prospect: { row: prospect.row, pubName: prospect.pubName, phone: prospect.phone, e164 },
    startedAt: new Date(),
    stage: 'calling-you',
    agent: { state: 'queued', muted: false },
    pub: { state: 'idle' },
    ai: { state: 'off', used: false },
    recording: false,
    events: [],
  };
  session = s;

  try {
    const call = await twilioClient.calls.create({
      to: config.AGENT_PHONE_NUMBER,
      from: config.TWILIO_PHONE_NUMBER,
      url: webhook('agent-answer', s),
      statusCallback: webhook('leg-status', s, '&leg=agent'),
      statusCallbackEvent: LEG_EVENTS,
      timeout: 25,
    });
    s.agent.callSid = call.sid;
  } catch (err) {
    end(s, `Couldn't ring your phone: ${(err as Error).message}`);
    throw new CockpitError(`Couldn't ring your phone: ${(err as Error).message}`, 502);
  }
  note(s, `Ringing your phone to call ${prospect.pubName}`);

  getSheets()
    ?.updateProspectStatus(prospect.pubName, 'Calling')
    .catch((err) => logger.warn('Cockpit: could not set prospect to Calling', { err }));
  return s;
}

/** TwiML for Swarnim's leg when he answers: confirm before the pub is dialled. */
export function agentAnswerTwiml(s: CockpitSession | undefined): string {
  const twiml = new VoiceResponse();
  const say = { voice: config.TTS_VOICE as never, language: config.TTS_LANGUAGE as never };
  if (!s || s.stage === 'ended') {
    twiml.say(say, 'This call has been cancelled.');
    twiml.hangup();
    return twiml.toString();
  }
  s.stage = 'waiting-for-you';
  const gather = twiml.gather({ numDigits: 1, timeout: 10, action: webhook('agent-connect', s), method: 'POST' });
  gather.say(say, `Calling ${s.prospect.pubName}. Press 1 to dial them, or hang up to cancel.`);
  twiml.say(say, 'No key pressed, so I have cancelled the call.');
  twiml.hangup();
  return twiml.toString();
}

/** TwiML after Swarnim's keypress: re-check, then put him in the conference. */
export async function agentConnectTwiml(s: CockpitSession | undefined, digits: string | undefined): Promise<string> {
  const twiml = new VoiceResponse();
  const say = { voice: config.TTS_VOICE as never, language: config.TTS_LANGUAGE as never };
  if (!s || s.stage === 'ended') {
    twiml.say(say, 'This call has been cancelled.');
    twiml.hangup();
    return twiml.toString();
  }
  if (digits !== '1') {
    end(s, 'Cancelled on your phone');
    twiml.say(say, 'Cancelled.');
    twiml.hangup();
    return twiml.toString();
  }
  try {
    await checkCanDial(s.prospect.pubName);
  } catch (err) {
    end(s, `Not dialled: ${(err as Error).message}`);
    twiml.say(say, `Not dialling. ${(err as Error).message}.`);
    twiml.hangup();
    return twiml.toString();
  }

  s.stage = 'dialling-pub';
  note(s, `Dialling ${s.prospect.pubName} on ${s.prospect.phone}`);
  twiml.dial().conference(
    {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      beep: 'false' as never,
      waitUrl: '',
      statusCallback: webhook('conference', s),
      statusCallbackEvent: ['start', 'end', 'join', 'leave'] as never,
    },
    s.conferenceName
  );
  return twiml.toString();
}

/** Conference events: dial the pub once Swarnim is in, track who's on. */
export async function onConferenceEvent(
  s: CockpitSession | undefined,
  event: { StatusCallbackEvent?: string; ConferenceSid?: string; CallSid?: string }
): Promise<void> {
  if (!s) return;
  switch (event.StatusCallbackEvent) {
    case 'conference-start': {
      s.conferenceSid = event.ConferenceSid;
      if (s.stage === 'ended' || s.pub.callSid) return;
      try {
        const pub = await twilioClient.conferences(s.conferenceSid!).participants.create({
          from: config.TWILIO_PHONE_NUMBER,
          to: s.prospect.e164,
          label: 'pub',
          earlyMedia: true,
          beep: 'false',
          startConferenceOnEnter: true,
          endConferenceOnExit: true,
          timeout: 30,
          statusCallback: webhook('leg-status', s, '&leg=pub'),
          statusCallbackEvent: LEG_EVENTS,
        });
        s.pub.callSid = pub.callSid;
        s.pub.state = 'queued';
      } catch (err) {
        note(s, `Couldn't dial the pub: ${(err as Error).message}`);
        await hangUp().catch(() => undefined);
      }
      return;
    }
    case 'participant-leave':
      if (event.CallSid && event.CallSid === s.ai.callSid) {
        s.ai.state = 'off';
        s.ai.callSid = undefined;
        note(s, 'Demo receptionist left the call');
      }
      return;
    case 'conference-end':
      end(s, 'Call ended');
      return;
  }
}

/** Status callbacks for each leg (agent, pub, ai). */
export function onLegStatus(s: CockpitSession | undefined, leg: string | undefined, state: string | undefined): void {
  if (!s || !state) return;
  const legState = state as LegState;
  if (leg === 'agent') {
    s.agent.state = legState;
    if (DONE_STATES.includes(legState)) {
      end(s, legState === 'completed' ? 'You hung up' : `Your phone: ${state}`);
    }
  } else if (leg === 'pub') {
    s.pub.state = legState;
    if (legState === 'in-progress' && !s.pub.answeredAt) {
      s.pub.answeredAt = new Date();
      s.stage = 'connected';
      note(s, `${s.prospect.pubName} answered`);
    } else if (DONE_STATES.includes(legState)) {
      note(s, s.pub.answeredAt ? `${s.prospect.pubName} hung up` : `${s.prospect.pubName}: ${state.replace('-', ' ')}`);
      // Never answered: don't leave Swarnim alone in a silent conference
      if (!s.pub.answeredAt && s.stage !== 'ended') {
        hangUp().catch((err) => logger.warn('Cockpit: hang-up after no answer failed', { err }));
      }
    }
  } else if (leg === 'ai') {
    if (legState === 'in-progress') {
      s.ai.state = 'on';
      note(s, 'Demo receptionist is on the line');
    } else if (DONE_STATES.includes(legState) && s.ai.state !== 'off') {
      s.ai.state = 'off';
      s.ai.callSid = undefined;
    }
  }
}

/** Step 3: bring the demo receptionist in, answering as this pub. */
export async function bringInDemo(): Promise<CockpitSession> {
  const s = requireLive();
  if (!s.conferenceSid || !s.agent.callSid) throw new CockpitError('Wait until the call is connected', 409);
  if (s.ai.state !== 'off') throw new CockpitError('The demo is already on the call', 409);

  const slug = slugify(s.prospect.pubName);
  const business = await db.business.findUnique({ where: { slug } });
  if (!business || business.mode !== 'DEMO') {
    throw new CockpitError(`No demo for ${s.prospect.pubName} yet — build it first`, 404);
  }

  // The AI must not hear Swarnim; he unmutes to take over
  await setMuted(true);
  expectCockpitDemo(business.id, (inboundCallSid) => {
    s.ai.inboundCallSid = inboundCallSid;
  });
  try {
    const ai = await twilioClient.conferences(s.conferenceSid).participants.create({
      from: config.TWILIO_PHONE_NUMBER,
      to: config.TWILIO_DEMO_APP_SID ? `app:${config.TWILIO_DEMO_APP_SID}` : config.TWILIO_PHONE_NUMBER,
      label: 'ai',
      beep: 'false',
      startConferenceOnEnter: true,
      endConferenceOnExit: false,
      statusCallback: webhook('leg-status', s, '&leg=ai'),
      statusCallbackEvent: LEG_EVENTS,
    });
    s.ai = { ...s.ai, callSid: ai.callSid, state: 'joining', used: true };
    note(s, `Bringing in the demo receptionist for ${business.name} — you're muted`);
  } catch (err) {
    cancelCockpitDemo();
    await setMuted(false).catch(() => undefined);
    throw new CockpitError(`Couldn't add the demo: ${(err as Error).message}`, 502);
  }
  return s;
}

/** Takes the AI off the call; Swarnim and the pub carry on. */
export async function removeDemo(): Promise<CockpitSession> {
  const s = requireLive();
  if (!s.conferenceSid || !s.ai.callSid) throw new CockpitError('The demo is not on the call', 409);
  await twilioClient.conferences(s.conferenceSid).participants(s.ai.callSid).remove();
  s.ai.state = 'off';
  s.ai.callSid = undefined;
  note(s, 'Removed the demo receptionist');
  await setMuted(false);
  return s;
}

export async function setMuted(muted: boolean): Promise<CockpitSession> {
  const s = requireLive();
  if (!s.conferenceSid || !s.agent.callSid) throw new CockpitError('Wait until the call is connected', 409);
  await twilioClient.conferences(s.conferenceSid).participants(s.agent.callSid).update({ muted });
  s.agent.muted = muted;
  note(s, muted ? 'You are muted' : 'You are unmuted');
  return s;
}

/** Records the call from Swarnim's leg (the whole conference mix). */
export async function startRecording(): Promise<CockpitSession> {
  const s = requireLive();
  if (!config.RECORD_SALES_CALLS) throw new CockpitError('Recording sales calls is off (RECORD_SALES_CALLS)', 403);
  if (!s.agent.callSid || s.stage !== 'connected') throw new CockpitError('Wait until the pub has answered', 409);
  if (s.recording) return s;
  await twilioClient.calls(s.agent.callSid).recordings.create({
    recordingChannels: 'mono',
    recordingStatusCallback: webhook('recording', s),
    recordingStatusCallbackEvent: ['completed'],
  });
  s.recording = true;
  note(s, 'Recording (prospect told)');
  return s;
}

export async function hangUp(): Promise<CockpitSession> {
  const s = requireLive();
  if (s.conferenceSid) {
    await twilioClient.conferences(s.conferenceSid).update({ status: 'completed' });
  } else if (s.agent.callSid) {
    await twilioClient.calls(s.agent.callSid).update({ status: 'completed' });
  }
  end(s, 'Hung up from the cockpit');
  return s;
}

// ─── Step 4: outcome ─────────────────────────────────────────────────────────

export interface OutcomeInput {
  outcome: CallOutcome;
  status?: ProspectStatus;
  spokeTo?: string;
  reachedDecisionMaker?: boolean;
  demoReaction?: number;
  mainObjection?: string;
  nextStep?: string;
  followUpDate?: Date;
  notes?: string;
}

export async function saveOutcome(input: OutcomeInput): Promise<{ callLogRow: number; status: ProspectStatus }> {
  const s = session;
  if (!s) throw new CockpitError('No call to log', 409);
  if (s.stage !== 'ended') throw new CockpitError('Hang up before logging the outcome', 409);
  if (!CALL_OUTCOMES.includes(input.outcome)) throw new CockpitError(`Unknown outcome "${input.outcome}"`);
  const sheets = requireSheets();

  // Asking not to be called always wins over whatever status was picked
  const status =
    input.outcome === 'Asked not to be called' ? 'Do not call' : (input.status ?? DEFAULT_STATUS_FOR_OUTCOME[input.outcome]);
  if (!PROSPECT_STATUSES.includes(status)) throw new CockpitError(`Unknown status "${status}"`);

  let transcript = '';
  if (s.ai.inboundCallSid) {
    const call = await db.call.findUnique({ where: { callSid: s.ai.inboundCallSid }, select: { id: true } }).catch(() => null);
    if (call) transcript = ` Demo transcript: ${config.BASE_URL}/api/calls/${call.id}/transcript`;
  }

  const callLogRow = await sheets.appendCallLog({
    date: s.startedAt,
    pubName: s.prospect.pubName,
    spokeTo: input.spokeTo,
    reachedDecisionMaker: input.reachedDecisionMaker ?? false,
    aiDemoUsed: s.ai.used,
    outcome: input.outcome,
    demoReaction: s.ai.used ? input.demoReaction : undefined,
    mainObjection: input.mainObjection,
    nextStep: input.nextStep,
    followUpDate: input.followUpDate,
    notes: ((input.notes ?? '') + transcript).trim() || undefined,
  });
  await sheets.updateProspectStatus(s.prospect.pubName, status, input.followUpDate);
  if (input.outcome === 'Asked not to be called') {
    await sheets.appendDoNotCall({
      pubName: s.prospect.pubName,
      phone: s.prospect.phone,
      date: new Date(),
      reason: input.notes || 'Asked not to be called',
      howTheyAsked: 'On a sales call',
    });
  }
  logger.info('Cockpit: outcome saved', { pub: s.prospect.pubName, outcome: input.outcome, status, callLogRow });
  session = undefined;
  return { callLogRow, status };
}

/** Drops an ended call without logging it (e.g. a test call). */
export function discardSession(): void {
  if (session && session.stage !== 'ended') throw new CockpitError('Hang up first', 409);
  session = undefined;
}

/** Test hook. */
export function _resetForTests(): void {
  session = undefined;
}
