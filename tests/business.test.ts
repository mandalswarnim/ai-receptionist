import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  findUnique: vi.fn(),
  config: {
    COMPANY_NAME: 'The Crown',
    PERSONA_NAME: 'Maya',
    BUSINESS_EMAIL: 'owner@example.com',
    TWILIO_PHONE_NUMBER: '+447000000000',
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
  toProfile,
} from '../src/services/business.service';

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
