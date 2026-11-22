import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BusinessProfile } from '../src/services/business.service';
import type { ConversationState } from '../src/types';

const mocks = vi.hoisted(() => ({
  config: { COMPANY_TIMEZONE: 'Europe/London', CALENDLY_API_TOKEN: 'token' as string | undefined },
  getAvailableTimes: vi.fn(),
  createBooking: vi.fn(),
  getEventType: vi.fn(),
  sendSms: vi.fn(),
}));

vi.mock('../src/config', () => ({ config: mocks.config }));
vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/services/twilio.service', () => ({ sendSms: mocks.sendSms }));
vi.mock('../src/services/calendly.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/calendly.service')>()),
  getAvailableTimes: mocks.getAvailableTimes,
  createBooking: mocks.createBooking,
  getEventType: mocks.getEventType,
}));

import {
  appointmentsEnabled,
  bookingLocation,
  formatSlot,
  promptSection,
  runTool,
  startOfLocalDay,
  summaryLine,
} from '../src/services/appointment.service';
import { CalendlyError } from '../src/services/calendly.service';

const EVENT_TYPE = 'https://api.calendly.com/event_types/ABC123';

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
  notifyEmail: 'owner@acme.test',
  calendlyEventType: EVENT_TYPE,
  tier: 'AGATHOS',
  notifyChannel: 'EMAIL',
  whatsappNumbers: [],
  whatsappOptInAt: null,
};

// Sunday 18 October 2026, 10:00 in London (BST)
const NOW = new Date('2026-10-18T09:00:00Z');
const SLOT_A = '2026-10-20T13:00:00.000Z'; // Tue 2pm BST
const SLOT_B = '2026-10-20T14:00:00.000Z';

function state(over: Partial<ConversationState> = {}): ConversationState {
  return {
    callSid: 'CA1',
    from: '+447700900123',
    business: BUSINESS,
    step: 'collect_name',
    collectedInfo: {},
    turnCount: 0,
    turns: [],
    startedAt: NOW,
    silentPrompts: 0,
    ...over,
  };
}

const args = (v: unknown) => JSON.stringify(v);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.CALENDLY_API_TOKEN = 'token';
  mocks.getEventType.mockResolvedValue({
    uri: EVENT_TYPE,
    name: 'Initial assessment',
    durationMinutes: 30,
    schedulingUrl: 'https://calendly.com/acme/assessment',
    locations: [],
    active: true,
  });
  mocks.getAvailableTimes.mockResolvedValue([SLOT_A, SLOT_B]);
  mocks.createBooking.mockResolvedValue({ eventUri: 'https://api.calendly.com/scheduled_events/EV1', cancelUrl: null, rescheduleUrl: null });
});

describe('enabled', () => {
  it('needs both the token and an event type on the business', () => {
    expect(appointmentsEnabled(BUSINESS)).toBe(true);
    expect(appointmentsEnabled({ ...BUSINESS, calendlyEventType: null })).toBe(false);
    mocks.config.CALENDLY_API_TOKEN = undefined;
    expect(appointmentsEnabled(BUSINESS)).toBe(false);
  });
});

describe('dates', () => {
  it('finds local midnight either side of the clocks changing', () => {
    expect(startOfLocalDay('2026-10-20', 'Europe/London').toISOString()).toBe('2026-10-19T23:00:00.000Z'); // BST
    expect(startOfLocalDay('2026-11-02', 'Europe/London').toISOString()).toBe('2026-11-02T00:00:00.000Z'); // GMT
  });

  it('formats a slot the way it is said', () => {
    expect(formatSlot(SLOT_A, 'Europe/London')).toBe('Tuesday 20 October at 2:00 pm');
  });
});

describe('check_availability', () => {
  it('asks Calendly for whole local days and remembers what it offered', async () => {
    const s = state();
    const out = await runTool(s, 'check_availability', args({ from_date: '2026-10-20', to_date: null }), NOW);
    expect(mocks.getAvailableTimes).toHaveBeenCalledWith(
      EVENT_TYPE,
      new Date('2026-10-19T23:00:00.000Z'),
      new Date('2026-10-20T23:00:00.000Z')
    );
    expect(out).toContain(`Tuesday 20 October at 2:00 pm = ${SLOT_A}`);
    expect(s.appointment?.offered).toEqual([SLOT_A, SLOT_B]);
  });

  it('starts from now for today and caps the range at 7 days', async () => {
    await runTool(state(), 'check_availability', args({ from_date: '2026-10-01', to_date: '2026-12-01' }), NOW);
    const [, from, to] = mocks.getAvailableTimes.mock.calls[0];
    expect(from.getTime()).toBe(NOW.getTime() + 60_000);
    expect((to as Date).toISOString()).toBe('2026-10-24T23:00:00.000Z'); // end of Sat 24th
  });

  it('says so when nothing is free', async () => {
    mocks.getAvailableTimes.mockResolvedValue([]);
    const out = await runTool(state(), 'check_availability', args({ from_date: '2026-10-20', to_date: null }), NOW);
    expect(out).toContain('No open times');
  });

  it('turns a Calendly failure into a take-a-message instruction', async () => {
    mocks.getAvailableTimes.mockRejectedValue(new CalendlyError('down', 503));
    const out = await runTool(state(), 'check_availability', args({ from_date: '2026-10-20', to_date: null }), NOW);
    expect(out).toContain("diary isn't available");
  });
});

describe('book_appointment', () => {
  const offered = () => state({ appointment: { offered: [SLOT_A, SLOT_B] } });

  it('books an offered time and records it on the call', async () => {
    const s = offered();
    const out = await runTool(s, 'book_appointment', args({ start_time: SLOT_A, name: 'Jane Smith', email: 'Jane@Example.com' }));
    expect(mocks.createBooking).toHaveBeenCalledWith({
      eventTypeUri: EVENT_TYPE,
      startTime: SLOT_A,
      name: 'Jane Smith',
      email: 'jane@example.com',
      timezone: 'Europe/London',
      location: undefined,
    });
    expect(out).toContain('Booked');
    expect(s.appointment?.booked?.label).toBe('Tuesday 20 October at 2:00 pm');
    expect(summaryLine(s)).toBe(
      'Appointment booked in Calendly for Tuesday 20 October at 2:00 pm (Jane Smith, jane@example.com).'
    );
  });

  it('accepts the same instant written differently', async () => {
    await runTool(offered(), 'book_appointment', args({ start_time: '2026-10-20T13:00:00Z', name: 'Jane', email: 'j@x.co' }));
    expect(mocks.createBooking).toHaveBeenCalledWith(expect.objectContaining({ startTime: SLOT_A }));
  });

  it('refuses a time the diary never offered', async () => {
    const out = await runTool(offered(), 'book_appointment', args({ start_time: '2026-10-21T09:00:00Z', name: 'Jane', email: 'j@x.co' }));
    expect(out).toContain('not offered');
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it('asks again for a bad email', async () => {
    const out = await runTool(offered(), 'book_appointment', args({ start_time: SLOT_A, name: 'Jane', email: 'jane at gmail' }));
    expect(out).toContain('spell it again');
  });

  it('books once per call', async () => {
    const s = offered();
    await runTool(s, 'book_appointment', args({ start_time: SLOT_A, name: 'Jane', email: 'j@x.co' }));
    const out = await runTool(s, 'book_appointment', args({ start_time: SLOT_B, name: 'Jane', email: 'j@x.co' }));
    expect(out).toContain('Already booked');
    expect(mocks.createBooking).toHaveBeenCalledTimes(1);
  });

  it('drops a slot Calendly says has gone', async () => {
    mocks.createBooking.mockRejectedValue(new CalendlyError('The selected time is no longer available', 400));
    const s = offered();
    const out = await runTool(s, 'book_appointment', args({ start_time: SLOT_A, name: 'Jane', email: 'j@x.co' }));
    expect(out).toContain('no longer available');
    expect(s.appointment?.offered).toEqual([SLOT_B]);
    expect(s.appointment?.booked).toBeUndefined();
  });

  it('sends the caller number for a "we will ring you" appointment', async () => {
    mocks.getEventType.mockResolvedValue({ ...(await mocks.getEventType()), locations: [{ kind: 'outbound_call' }] });
    await runTool(offered(), 'book_appointment', args({ start_time: SLOT_A, name: 'Jane', email: 'j@x.co' }));
    expect(mocks.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ location: { kind: 'outbound_call', location: '+447700900123' } })
    );
  });
});

describe('booking location', () => {
  it('picks what can be filled in over the phone', () => {
    expect(bookingLocation([], '+447700900123')).toBeUndefined();
    expect(bookingLocation([{ kind: 'physical', location: '1 High St' }], 'anonymous')).toEqual({
      kind: 'physical',
      location: '1 High St',
    });
    expect(bookingLocation([{ kind: 'google_conference' }], 'anonymous')).toEqual({ kind: 'google_conference' });
    expect(bookingLocation([{ kind: 'outbound_call' }], 'anonymous')).toBeNull();
    expect(bookingLocation([{ kind: 'ask_invitee' }], '+447700900123')).toBeNull();
  });
});

describe('text_booking_link', () => {
  it('texts the scheduling link once', async () => {
    const s = state();
    await runTool(s, 'text_booking_link', '{}');
    const again = await runTool(s, 'text_booking_link', '{}');
    expect(mocks.sendSms).toHaveBeenCalledTimes(1);
    expect(mocks.sendSms).toHaveBeenCalledWith(
      '+447700900123',
      'Book your appointment with Acme Physio here: https://calendly.com/acme/assessment'
    );
    expect(again).toContain('already');
    expect(summaryLine(s)).toBe('A Calendly booking link was texted to the caller.');
  });

  it('cannot text a withheld number', async () => {
    const out = await runTool(state({ from: 'anonymous' }), 'text_booking_link', '{}');
    expect(out).toContain('withheld');
    expect(mocks.sendSms).not.toHaveBeenCalled();
  });
});

describe('prompt section', () => {
  it("gives today's date and the times offered", () => {
    const text = promptSection(state({ appointment: { offered: [SLOT_A] } }), NOW);
    expect(text).toContain('Today is Sunday, 18 October 2026.');
    expect(text).toContain('Times the diary offered so far: Tuesday 20 October at 2:00 pm.');
  });

  it('says when the call already has a booking', () => {
    const text = promptSection(
      state({
        appointment: {
          offered: [],
          booked: { startTime: SLOT_A, label: 'Tuesday 20 October at 2:00 pm', name: 'Jane', email: 'j@x.co', eventUri: 'x' },
        },
      }),
      NOW
    );
    expect(text).toContain("Already booked on this call: Tuesday 20 October at 2:00 pm for Jane. Don't book again");
  });
});
