/**
 * Admin API for the businesses the receptionist answers for (Bearer ADMIN_API_KEY).
 *
 * GET    /api/businesses          — List businesses
 * GET    /api/businesses/:slug    — Get one business
 * POST   /api/businesses          — Create a business (DEMO by default)
 * PATCH  /api/businesses/:slug    — Update a business
 * DELETE /api/businesses/:slug    — Delete a business (its calls are kept)
 *
 * WhatsApp summaries: set `whatsappNumbers`, `whatsappOptIn: true` (the
 * business has agreed to WhatsApp messages) and `notifyChannel` WHATSAPP or
 * BOTH. Only on tiers that include it. Changing the numbers without
 * `whatsappOptIn: true` clears the opt-in.
 */

import { Router, Request, Response } from 'express';
import { Prisma, type Tier } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';
import { requireAdminKey } from '../middleware';
import { DEFAULT_BUSINESS_SLUG, toProfile } from '../../services/business.service';
import { clearActiveDemo, getActiveDemo } from '../../services/demo.service';
import { EVENT_TYPE_URI } from '../../services/calendly.service';
import { hasFeature, TIERS, tiersWith } from '../../lib/tiers';

const router = Router();
router.use(requireAdminKey);

const optionalText = z.string().trim().max(4000).nullable().optional();

const fieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mode: z.enum(['DEMO', 'LIVE']),
  personaName: z.string().trim().min(1).max(50),
  greeting: z.string().trim().max(500).nullable().optional(),
  openingHours: optionalText,
  address: optionalText,
  bookingSystem: z.string().trim().max(200).nullable().optional(),
  bookingInstructions: optionalText,
  menuNotes: optionalText,
  faqs: z.array(z.object({ q: z.string().trim().min(1), a: z.string().trim().min(1) })).max(50),
  notifyEmail: z.string().trim().email().nullable().optional(),
  twilioNumber: z.string().regex(/^\+\d{7,15}$/, 'E.164, e.g. +447700900123').nullable().optional(),
  calendlyEventType: z
    .string()
    .trim()
    .regex(EVENT_TYPE_URI, 'Calendly event type URI, e.g. https://api.calendly.com/event_types/AAAA')
    .nullable()
    .optional(),
  tier: z.enum(TIERS as [Tier, ...Tier[]]).optional(),
  notifyChannel: z.enum(['EMAIL', 'WHATSAPP', 'BOTH']).optional(),
  whatsappNumbers: z
    .array(z.string().regex(/^\+\d{7,15}$/, 'E.164, e.g. +447700900123'))
    .max(5)
    .transform((nums) => [...new Set(nums)])
    .optional(),
  /** true records the business's WhatsApp opt-in now; false withdraws it. */
  whatsappOptIn: z.boolean().optional(),
});

const createSchema = fieldsSchema
  .partial({ mode: true, personaName: true, faqs: true })
  .extend({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase-words-with-dashes') });

const updateSchema = fieldsSchema.partial();

type Fields = z.infer<typeof updateSchema>;

/** The business as it would be after the change, for checkRules(). */
type Merged = Omit<Fields, 'whatsappOptIn'> & { whatsappOptInAt?: Date | null };

/**
 * Request fields → database fields. The opt-in is stored as a time; new
 * numbers without a fresh opt-in clear it, as those people haven't agreed.
 */
export function toData<T extends Fields>(
  fields: T,
  existing?: { whatsappNumbers: string[] }
): Omit<T, 'whatsappOptIn'> & { whatsappOptInAt?: Date | null } {
  const { whatsappOptIn, ...data } = fields;
  const numbersChanged =
    data.whatsappNumbers !== undefined &&
    data.whatsappNumbers.join() !== (existing?.whatsappNumbers ?? []).join();
  let whatsappOptInAt: Date | null | undefined;
  if (whatsappOptIn === true) whatsappOptInAt = new Date();
  else if (whatsappOptIn === false || numbersChanged) whatsappOptInAt = null;
  return whatsappOptInAt === undefined ? data : { ...data, whatsappOptInAt };
}

/**
 * Rules that protect the live missed-call path. Returns an error message or
 * undefined. `merged` is the business as it would be after the change.
 */
export function checkRules(slug: string, merged: Merged): string | undefined {
  if (slug === DEFAULT_BUSINESS_SLUG && merged.mode === 'DEMO') {
    return 'The default business answers real forwarded calls and must stay LIVE';
  }
  // A demo that owned a number would answer every call to it, indefinitely
  if (merged.mode === 'DEMO' && merged.twilioNumber) {
    return 'DEMO businesses cannot own a Twilio number; set them active with /api/demo/active instead';
  }
  if (merged.notifyChannel && merged.notifyChannel !== 'EMAIL') {
    if (merged.mode === 'DEMO') return 'Demo call summaries are only emailed';
    if (!hasFeature(merged.tier ?? 'AGATHOS', 'whatsappAlerts')) {
      return `WhatsApp summaries are on ${tiersWith('whatsappAlerts')}; this business is on ${merged.tier ?? 'AGATHOS'}`;
    }
    if (!merged.whatsappNumbers?.length) return 'Add whatsappNumbers before choosing WhatsApp';
    if (!merged.whatsappOptInAt) return 'Record the business\'s WhatsApp opt-in first (whatsappOptIn: true)';
  }
  return undefined;
}

function prismaError(res: Response, err: unknown, action: string): void {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: `Already in use: ${String(err.meta?.['target'] ?? 'unique field')}` });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
  }
  logger.error(`Failed to ${action} business`, { err });
  res.status(500).json({ error: `Failed to ${action} business` });
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const businesses = await db.business.findMany({ orderBy: [{ mode: 'asc' }, { name: 'asc' }] });
    res.json({ data: businesses.map((b) => ({ ...toProfile(b), twilioNumber: b.twilioNumber })) });
  } catch (err) {
    prismaError(res, err, 'list');
  }
});

router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const business = await db.business.findUnique({ where: { slug: req.params['slug'] as string } });
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    res.json({ ...toProfile(business), twilioNumber: business.twilioNumber });
  } catch (err) {
    prismaError(res, err, 'fetch');
  }
});

router.post('/', async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid business', issues: parsed.error.issues });
    return;
  }
  const data = { mode: 'DEMO' as const, personaName: 'Maya', faqs: [], ...toData(parsed.data) };
  const ruleError = checkRules(data.slug, data);
  if (ruleError) {
    res.status(400).json({ error: ruleError });
    return;
  }
  try {
    const business = await db.business.create({ data });
    logger.info('Business created', { slug: business.slug, mode: business.mode });
    res.status(201).json(business);
  } catch (err) {
    prismaError(res, err, 'create');
  }
});

router.patch('/:slug', async (req: Request, res: Response) => {
  const slug = req.params['slug'] as string;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid business', issues: parsed.error.issues });
    return;
  }
  try {
    const existing = await db.business.findUnique({ where: { slug } });
    if (!existing) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const data: Prisma.BusinessUpdateInput = toData(parsed.data, existing);
    const tier = parsed.data.tier ?? existing.tier;
    // Moving to a tier without WhatsApp goes back to email, unless the
    // request asks for WhatsApp itself (which checkRules then refuses)
    if (!hasFeature(tier, 'whatsappAlerts') && parsed.data.notifyChannel === undefined) data.notifyChannel = 'EMAIL';
    const ruleError = checkRules(slug, {
      mode: parsed.data.mode ?? existing.mode,
      twilioNumber: parsed.data.twilioNumber === undefined ? existing.twilioNumber : parsed.data.twilioNumber,
      tier,
      notifyChannel: (data.notifyChannel as Fields['notifyChannel']) ?? existing.notifyChannel,
      whatsappNumbers: parsed.data.whatsappNumbers ?? existing.whatsappNumbers,
      whatsappOptInAt: 'whatsappOptInAt' in data ? (data.whatsappOptInAt as Date | null) : existing.whatsappOptInAt,
    });
    if (ruleError) {
      res.status(400).json({ error: ruleError });
      return;
    }
    const business = await db.business.update({ where: { slug }, data });
    logger.info('Business updated', { slug, fields: Object.keys(parsed.data) });
    res.json(business);
  } catch (err) {
    prismaError(res, err, 'update');
  }
});

router.delete('/:slug', async (req: Request, res: Response) => {
  const slug = req.params['slug'] as string;
  if (slug === DEFAULT_BUSINESS_SLUG) {
    res.status(400).json({ error: 'The default business answers real forwarded calls and cannot be deleted' });
    return;
  }
  try {
    const business = await db.business.delete({ where: { slug } });
    if (getActiveDemo()?.businessId === business.id) clearActiveDemo();
    logger.info('Business deleted', { slug });
    res.sendStatus(204);
  } catch (err) {
    prismaError(res, err, 'delete');
  }
});

export default router;
