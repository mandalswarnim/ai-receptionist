import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  findUnique: vi.fn(),
  config: {
    COMPANY_NAME: 'The Crown',
    PERSONA_NAME: 'Maya',
    BUSINESS_EMAIL: 'owner@example.com',
    TWILIO_PHONE_NUMBER: '+447000000000',
    AGENT_PHONE_NUMBER: undefined as string | undefined,
  },
}));

vi.mock('../src/config', () => ({ config: mocks.config }));
vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/lib/db', () => ({
  db: { business: { upsert: mocks.upsert, findUnique: mocks.findUnique } },
}));

import {
  DEFAULT_BUSINESS_SLUG,
  defaultBusinessData,
  ensureDefaultBusiness,
  getDefaultBusiness,
  resolveBusinessForCall,
  toProfile,
} from '../src/services/business.service';
import { ACTIVE_DEMO_TTL_MS, clearActiveDemo, getActiveDemo, setActiveDemo } from '../src/services/demo.service';

const row = (over: Record<string, unknown>) => ({
  id: 'x',
  slug: 'x',
  name: 'X',
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
  twilioNumber: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const DEFAULT_ROW = row({ id: 'biz-default', slug: 'default', name: 'The Crown' });
const CUSTOMER_ROW = row({ id: 'biz-customer', slug: 'the-swan', name: 'The Swan', twilioNumber: '+441111111111' });
const DEMO_ROW = row({ id: 'biz-demo', slug: 'the-bell', name: 'The Bell', mode: 'DEMO' });
const ROWS = [DEFAULT_ROW, CUSTOMER_ROW, DEMO_ROW];

beforeEach(() => {
  vi.clearAllMocks();
  clearActiveDemo();
  mocks.config.AGENT_PHONE_NUMBER = undefined;
  mocks.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) => {
    const [[key, value]] = Object.entries(where);
    return ROWS.find((r) => (r as Record<string, unknown>)[key] === value) ?? null;
  });
});

describe('resolveBusinessForCall', () => {
  it('answers a forwarded call as the default business when no demo is active', async () => {
    const b = await resolveBusinessForCall({ to: '+447000000000', from: '+447700900123' });
    expect(b.slug).toBe('default');
  });

  it('the business that owns the dialled number always wins, even over an active demo', async () => {
    setActiveDemo('biz-demo');
    const b = await resolveBusinessForCall({ to: '+441111111111', from: '+447700900123' });
    expect(b.slug).toBe('the-swan');
  });

  it('uses the active demo for calls to the shared number', async () => {
    setActiveDemo('biz-demo');
    const b = await resolveBusinessForCall({ to: '+447000000000', from: '+447700900123' });
    expect(b.slug).toBe('the-bell');
  });

  it('with AGENT_PHONE_NUMBER set, real callers keep the default business during a demo', async () => {
    mocks.config.AGENT_PHONE_NUMBER = '+447999999999';
    setActiveDemo('biz-demo');

    const caller = await resolveBusinessForCall({ to: '+447000000000', from: '+447700900123' });
    const agent = await resolveBusinessForCall({ to: '+447000000000', from: '+44 7999 999999' });

    expect(caller.slug).toBe('default');
    expect(agent.slug).toBe('the-bell');
  });

  it('withheld callers never get the demo when AGENT_PHONE_NUMBER is set', async () => {
    mocks.config.AGENT_PHONE_NUMBER = '+447999999999';
    setActiveDemo('biz-demo');
    const b = await resolveBusinessForCall({ to: '+447000000000', from: 'anonymous' });
    expect(b.slug).toBe('default');
  });

  it('clears an active demo whose business was deleted', async () => {
    setActiveDemo('biz-gone');
    const b = await resolveBusinessForCall({ to: '+447000000000', from: '+447700900123' });
    expect(b.slug).toBe('default');
    expect(getActiveDemo()).toBeUndefined();
  });

  it('falls back to the default business when the lookup fails', async () => {
    mocks.findUnique.mockRejectedValueOnce(new Error('db blip'));
    const b = await resolveBusinessForCall({ to: '+447000000000', from: '+447700900123' });
    expect(b.slug).toBe('default');
  });
});

describe('active demo', () => {
  it('expires after 30 minutes', () => {
    const now = new Date('2026-10-13T12:00:00Z');
    setActiveDemo('biz-demo', now);
    expect(getActiveDemo(new Date(now.getTime() + ACTIVE_DEMO_TTL_MS - 1))).toBeDefined();
    expect(getActiveDemo(new Date(now.getTime() + ACTIVE_DEMO_TTL_MS))).toBeUndefined();
  });
});

describe('getDefaultBusiness', () => {
  it('falls back to the env values when the database is down, so calls still get answered', async () => {
    mocks.findUnique.mockRejectedValueOnce(new Error('db down'));

    const business = await getDefaultBusiness();

    expect(business).toMatchObject({ id: null, name: 'The Crown', mode: 'LIVE', notifyEmail: 'owner@example.com' });
  });
});

describe('toProfile', () => {
  it('drops FAQs that are not a list of { q, a }', () => {
    const row = { faqs: 'not a list' } as unknown as Parameters<typeof toProfile>[0];
    expect(toProfile(row).faqs).toEqual([]);
  });
});

describe('default business', () => {
  it('is a LIVE business built from the env vars', () => {
    expect(defaultBusinessData()).toEqual({
      slug: DEFAULT_BUSINESS_SLUG,
      name: 'The Crown',
      mode: 'LIVE',
      personaName: 'Maya',
      notifyEmail: 'owner@example.com',
    });
  });

  it('does not claim the Twilio number, so active demos can still be routed', () => {
    expect(defaultBusinessData().twilioNumber).toBeUndefined();
  });

  it('creates it if missing and never overwrites an existing record', async () => {
    await ensureDefaultBusiness();
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { slug: DEFAULT_BUSINESS_SLUG },
      create: defaultBusinessData(),
      update: {},
    });
  });
});
