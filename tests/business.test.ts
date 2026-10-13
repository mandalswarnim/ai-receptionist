import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  config: {
    COMPANY_NAME: 'The Crown',
    PERSONA_NAME: 'Maya',
    BUSINESS_EMAIL: 'owner@example.com',
    TWILIO_PHONE_NUMBER: '+447000000000',
  },
}));

vi.mock('../src/config', () => ({ config: mocks.config }));
vi.mock('../src/lib/db', () => ({ db: { business: { upsert: mocks.upsert } } }));

import {
  DEFAULT_BUSINESS_SLUG,
  defaultBusinessData,
  ensureDefaultBusiness,
} from '../src/services/business.service';

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
