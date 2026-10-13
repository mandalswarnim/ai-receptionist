import type { Business, Prisma } from '@prisma/client';
import { config } from '../config';
import { db } from '../lib/db';

/** Slug of the business built from env vars, used when no other business matches a call. */
export const DEFAULT_BUSINESS_SLUG = 'default';

/**
 * The default business, built from the legacy env vars (COMPANY_NAME,
 * PERSONA_NAME, BUSINESS_EMAIL) so existing setups behave exactly as before.
 *
 * twilioNumber is deliberately left empty: the default business is the
 * fallback, and claiming our number here would stop active demos from ever
 * being picked for calls to it.
 */
export function defaultBusinessData(): Prisma.BusinessCreateInput {
  return {
    slug: DEFAULT_BUSINESS_SLUG,
    name: config.COMPANY_NAME,
    mode: 'LIVE',
    personaName: config.PERSONA_NAME,
    notifyEmail: config.BUSINESS_EMAIL,
  };
}

/**
 * Creates the default business if it doesn't exist. An existing record is
 * left untouched so edits made through the admin API aren't overwritten.
 */
export async function ensureDefaultBusiness(): Promise<Business> {
  return db.business.upsert({
    where: { slug: DEFAULT_BUSINESS_SLUG },
    create: defaultBusinessData(),
    update: {},
  });
}
