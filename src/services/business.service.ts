import type { Business, BusinessMode, Prisma } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../lib/db';
import { logger } from '../lib/logger';

/** Slug of the business built from env vars, used when no other business matches a call. */
export const DEFAULT_BUSINESS_SLUG = 'default';

export interface Faq {
  q: string;
  a: string;
}

/**
 * The business a call is answered for, as the live call and post-call
 * pipeline see it. `id` is null only for the env fallback used when the
 * database can't be read, so a call never fails for want of a business.
 */
export interface BusinessProfile {
  id: string | null;
  slug: string;
  name: string;
  mode: BusinessMode;
  personaName: string;
  greeting: string | null;
  openingHours: string | null;
  address: string | null;
  bookingSystem: string | null;
  bookingInstructions: string | null;
  menuNotes: string | null;
  faqs: Faq[];
  notifyEmail: string | null;
}

const faqsSchema = z.array(z.object({ q: z.string(), a: z.string() })).catch([]);

export function toProfile(business: Business): BusinessProfile {
  return {
    id: business.id,
    slug: business.slug,
    name: business.name,
    mode: business.mode,
    personaName: business.personaName,
    greeting: business.greeting,
    openingHours: business.openingHours,
    address: business.address,
    bookingSystem: business.bookingSystem,
    bookingInstructions: business.bookingInstructions,
    menuNotes: business.menuNotes,
    faqs: faqsSchema.parse(business.faqs),
    notifyEmail: business.notifyEmail,
  };
}

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

/** The default business straight from env, for when the database is unavailable. */
export function envFallbackProfile(): BusinessProfile {
  return {
    id: null,
    slug: DEFAULT_BUSINESS_SLUG,
    name: config.COMPANY_NAME,
    mode: 'LIVE',
    personaName: config.PERSONA_NAME,
    greeting: null,
    openingHours: null,
    address: null,
    bookingSystem: null,
    bookingInstructions: null,
    menuNotes: null,
    faqs: [],
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

/**
 * The default business, created on first use. Falls back to the env values
 * if the database can't be reached: answering the call matters more than
 * linking it to a record.
 */
export async function getDefaultBusiness(): Promise<BusinessProfile> {
  try {
    const existing = await db.business.findUnique({ where: { slug: DEFAULT_BUSINESS_SLUG } });
    return toProfile(existing ?? (await ensureDefaultBusiness()));
  } catch (err) {
    logger.error('Could not load the default business — using env values', { err });
    return envFallbackProfile();
  }
}

/** The business a stored call belongs to, or the default for older calls. */
export async function profileForCall(business: Business | null): Promise<BusinessProfile> {
  return business ? toProfile(business) : getDefaultBusiness();
}
