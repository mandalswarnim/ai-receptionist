/**
 * Appointment booking on live calls: the tools the receptionist can call
 * (check the Calendly diary, book a slot, text a booking link), the prompt
 * section that tells it how, and the code that runs each tool.
 *
 * Only on when CALENDLY_API_TOKEN is set and the business has a
 * calendlyEventType. Otherwise nothing here is used and calls take a message
 * exactly as before.
 *
 * Guard rails live in code, not just the prompt: only a time the diary just
 * offered can be booked, one booking and one text per call, and every
 * failure tells the model to fall back to taking a message.
 */

import type OpenAI from 'openai';
import { z } from 'zod';
import { config } from '../config';
import { logger } from '../lib/logger';
import { isDialableNumber } from '../lib/phone';
import type { AppointmentState, ConversationState } from '../types';
import type { BusinessProfile } from './business.service';
import * as calendly from './calendly.service';
import { sendSms } from './twilio.service';

/** Most open times listed back to the model from one availability check. */
const MAX_SLOTS_LISTED = 30;

export function appointmentsEnabled(business: BusinessProfile): boolean {
  return calendly.calendlyConfigured() && !!business.calendlyEventType;
}

/** Warms the event type cache at call start so the first check is quick. */
export function prefetch(business: BusinessProfile): void {
  if (!appointmentsEnabled(business)) return;
  calendly
    .getEventType(business.calendlyEventType!)
    .catch((err) => logger.warn('Calendly: could not load event type', { business: business.slug, err }));
}

function timezone(): string {
  return config.COMPANY_TIMEZONE;
}

// ─── Dates in the business timezone ─────────────────────────────────────────

/** Milliseconds `tz` is ahead of UTC at `at`. */
function tzOffsetMs(at: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(at)
      .map((p) => [p.type, Number(p.value)])
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Midnight at the start of `ymd` (YYYY-MM-DD) in `tz`. */
export function startOfLocalDay(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Twice, so a DST change between the guess and the answer is accounted for
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

/** Today's date (YYYY-MM-DD) in `tz`. */
export function localDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(at);
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "Tuesday 20 October at 2:00 pm" in `tz`. */
export function formatSlot(iso: string, tz: string): string {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(at);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(at);
  return `${day} at ${time}`;
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

/**
 * The appointments section of the system prompt, including where this call
 * has got to (times offered, booking made), so the model never loses track
 * between turns.
 */
export function promptSection(state: ConversationState, now: Date = new Date()): string {
  const tz = timezone();
  const appt = state.appointment;
  const lines = [
    `\n\nBooking appointments: you can book callers straight into the ${state.business.name} diary.`,
    `- Today is ${new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'full' }).format(now)}. Work out dates like "next Tuesday" from that.`,
    `- When they want an appointment, ask what day suits, say a short line like "Let me just check the diary", then call check_availability. Offer two or three of the times it returns, never the whole list, and never make a time up.`,
    `- To book you need their full name and an email address (the confirmation goes there). Ask them to spell the email, read it back letter by letter, and get a clear yes.`,
    `- Read the day and time back and get a clear yes before calling book_appointment. Only book a time check_availability gave you.`,
    `- Once it's booked, tell them it's confirmed and the details are on their email.`,
    `- If they'd rather not give an email, or no time suits, offer to text them a link to book themselves, and call text_booking_link once they agree.`,
    `- If the diary isn't working, apologise once, take their name, number and preferred times, and say the team will be in touch to arrange it.`,
  ];
  if (appt?.booked) {
    lines.push(`- Already booked on this call: ${appt.booked.label} for ${appt.booked.name}. Don't book again; if they want to change it, take a message for the team.`);
  } else if (appt?.offered.length) {
    lines.push(`- Times the diary offered so far: ${appt.offered.map((t) => formatSlot(t, tz)).join('; ')}.`);
  }
  if (appt?.linkTextedTo) lines.push(`- A booking link has already been texted to them.`);
  return lines.join('\n');
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: `Open appointment times in the diary for a day, or up to ${calendly.MAX_RANGE_DAYS} days.`,
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['from_date', 'to_date'],
        properties: {
          from_date: { type: 'string', description: 'First day to check, YYYY-MM-DD' },
          to_date: { type: ['string', 'null'], description: 'Last day to check, YYYY-MM-DD; null for just from_date' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Books the caller into a time check_availability returned, after they have confirmed it.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['start_time', 'name', 'email'],
        properties: {
          start_time: { type: 'string', description: 'The ISO start time exactly as check_availability gave it' },
          name: { type: 'string', description: "The caller's full name" },
          email: { type: 'string', description: 'Their confirmed email address, e.g. jane.smith@gmail.com' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'text_booking_link',
      description: 'Texts the caller a link to book online, to the number they are calling from.',
      strict: true,
      parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
    },
  },
];

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const checkArgs = z.object({ from_date: ymd, to_date: ymd.nullable() });
const bookArgs = z.object({
  start_time: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
});

function appointmentState(state: ConversationState): AppointmentState {
  return (state.appointment ??= { offered: [] });
}

const DIARY_DOWN =
  "The diary isn't available right now. Apologise, take their name, number and preferred times, and say the team will be in touch to arrange it.";

/**
 * Runs one tool call and returns the result for the model. Never throws:
 * every failure becomes an instruction the model can act on.
 */
export async function runTool(
  state: ConversationState,
  name: string,
  rawArgs: string,
  now: Date = new Date()
): Promise<string> {
  const eventType = state.business.calendlyEventType;
  if (!appointmentsEnabled(state.business) || !eventType) return DIARY_DOWN;

  let args: unknown;
  try {
    args = JSON.parse(rawArgs || '{}');
  } catch {
    return 'Those arguments were not valid JSON. Try again.';
  }

  try {
    switch (name) {
      case 'check_availability':
        return await checkAvailability(state, eventType, args, now);
      case 'book_appointment':
        return await book(state, eventType, args);
      case 'text_booking_link':
        return await textLink(state, eventType);
      default:
        return `There is no tool called ${name}.`;
    }
  } catch (err) {
    logger.error('Appointment tool failed', { callSid: state.callSid, tool: name, err });
    return DIARY_DOWN;
  }
}

async function checkAvailability(state: ConversationState, eventType: string, raw: unknown, now: Date): Promise<string> {
  const parsed = checkArgs.safeParse(raw);
  if (!parsed.success) return 'Dates must be YYYY-MM-DD.';
  const tz = timezone();
  const today = localDate(now, tz);
  const fromDay = parsed.data.from_date < today ? today : parsed.data.from_date;
  let toDay = parsed.data.to_date && parsed.data.to_date >= fromDay ? parsed.data.to_date : fromDay;
  const lastAllowed = addDays(fromDay, calendly.MAX_RANGE_DAYS - 1);
  if (toDay > lastAllowed) toDay = lastAllowed;

  // Calendly only accepts a start time in the future
  const from = new Date(Math.max(startOfLocalDay(fromDay, tz).getTime(), now.getTime() + 60_000));
  const to = startOfLocalDay(addDays(toDay, 1), tz);
  if (to <= from) return 'That day is already over. Ask about another day.';

  const times = await calendly.getAvailableTimes(eventType, from, to);
  const appt = appointmentState(state);
  appt.offered = times;
  logger.info('Calendly: availability checked', { callSid: state.callSid, fromDay, toDay, open: times.length });

  if (times.length === 0) {
    return `No open times between ${fromDay} and ${toDay}. Ask if another day would work.`;
  }
  const listed = times.slice(0, MAX_SLOTS_LISTED).map((t) => `${formatSlot(t, tz)} = ${t}`);
  const more = times.length > listed.length ? `\n(${times.length - listed.length} more later on; ask if they prefer a time of day.)` : '';
  return `Open times (say them naturally; pass the ISO value to book_appointment):\n${listed.join('\n')}${more}`;
}

async function book(state: ConversationState, eventType: string, raw: unknown): Promise<string> {
  const appt = appointmentState(state);
  if (appt.booked) return `Already booked on this call for ${appt.booked.label}. Do not book again.`;

  const parsed = bookArgs.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.some((i) => i.path[0] === 'email')
      ? "That email address isn't valid. Ask them to spell it again."
      : 'A name, email and start time are all needed.';
  }
  const { name, email } = parsed.data;
  const startTime = appt.offered.find((t) => t === parsed.data.start_time || Date.parse(t) === Date.parse(parsed.data.start_time));
  if (!startTime) return 'That time was not offered by check_availability. Check availability again first.';

  const info = await calendly.getEventType(eventType);
  const location = bookingLocation(info.locations, state.from);
  if (location === null) {
    return "This appointment can't be booked over the phone. Offer to text them a booking link instead.";
  }

  const tz = timezone();
  try {
    const booking = await calendly.createBooking({ eventTypeUri: eventType, startTime, name, email, timezone: tz, location });
    const label = formatSlot(startTime, tz);
    appt.booked = { startTime, label, name, email, eventUri: booking.eventUri };
    logger.info('Calendly: appointment booked', { callSid: state.callSid, startTime, event: booking.eventUri });
    return `Booked: ${info.name} on ${label}. A confirmation is on its way to ${email}.`;
  } catch (err) {
    if (err instanceof calendly.CalendlyError && err.status && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403) {
      logger.warn('Calendly: booking refused', { callSid: state.callSid, status: err.status, message: err.message });
      appt.offered = appt.offered.filter((t) => t !== startTime);
      return `Calendly couldn't book that: ${err.message}. If the time has gone, check availability again and offer another.`;
    }
    throw err;
  }
}

/**
 * The location to send with a booking: none when the event type has none,
 * the host's own location when it sets one, the caller's number for a
 * "we'll ring you" event, and null when it needs details we can't take by phone.
 */
export function bookingLocation(
  locations: calendly.EventTypeLocation[],
  callerNumber: string
): calendly.EventTypeLocation | undefined | null {
  if (locations.length === 0) return undefined;
  const hostSet = locations.find((l) => !['ask_invitee', 'outbound_call'].includes(l.kind));
  if (hostSet) return hostSet.location ? { kind: hostSet.kind, location: hostSet.location } : { kind: hostSet.kind };
  if (locations.some((l) => l.kind === 'outbound_call') && isDialableNumber(callerNumber)) {
    return { kind: 'outbound_call', location: callerNumber };
  }
  return null;
}

async function textLink(state: ConversationState, eventType: string): Promise<string> {
  const appt = appointmentState(state);
  if (appt.linkTextedTo) return 'The link has already been texted to them.';
  if (!isDialableNumber(state.from)) {
    return "Their number is withheld, so a text can't be sent. Take their details for the team instead.";
  }
  const info = await calendly.getEventType(eventType);
  await sendSms(state.from, `Book your appointment with ${state.business.name} here: ${info.schedulingUrl}`);
  appt.linkTextedTo = state.from;
  logger.info('Calendly: booking link texted', { callSid: state.callSid });
  return 'Texted. Tell them the link is on its way to the number they are calling from.';
}

/** One line for the call summary, or '' when nothing was booked or sent. */
export function summaryLine(state: ConversationState): string {
  const appt = state.appointment;
  if (appt?.booked) return `Appointment booked in Calendly for ${appt.booked.label} (${appt.booked.name}, ${appt.booked.email}).`;
  if (appt?.linkTextedTo) return 'A Calendly booking link was texted to the caller.';
  return '';
}
