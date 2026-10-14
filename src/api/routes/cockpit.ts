/**
 * Calling cockpit API (Bearer ADMIN_API_KEY), used by the /cockpit page.
 *
 * GET    /api/cockpit/status              — Setup checks + calling window
 * GET    /api/cockpit/queue               — Prospects due today (from the Sheet)
 * POST   /api/cockpit/demo { pubName }    — Build/rebuild a pub's demo from its Prospects row
 * POST   /api/cockpit/call { pubName }    — Ring your phone, then dial the pub
 * GET    /api/cockpit/session             — The current call
 * POST   /api/cockpit/session/demo        — Bring in the demo receptionist
 * DELETE /api/cockpit/session/demo        — Remove it
 * POST   /api/cockpit/session/mute { muted }
 * POST   /api/cockpit/session/record      — Record (RECORD_SALES_CALLS, prospect told)
 * POST   /api/cockpit/session/hangup
 * POST   /api/cockpit/session/outcome     — Log the call to the Sheet
 * DELETE /api/cockpit/session             — Discard an ended call without logging
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';
import { requireAdminKey } from '../middleware';
import * as cockpit from '../../services/cockpit.service';
import { CALL_OUTCOMES, getSheets, PROSPECT_STATUSES } from '../../services/sheets.service';
import { buildDemoDraft, prospectNotes, saveDemo, slugify } from '../../services/demo-builder.service';
import { DEFAULT_CALLING_HOURS } from '../../lib/calling-hours';

const router = Router();
router.use(requireAdminKey);

/** Wraps a handler: CockpitErrors become their status, anything else a 500. */
const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, _next: NextFunction) =>
    fn(req, res).catch((err: unknown) => {
      if (err instanceof cockpit.CockpitError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error('Cockpit request failed', { path: req.path, err });
      res.status(500).json({ error: (err as Error).message || 'Something went wrong' });
    });

const pubNameBody = z.object({ pubName: z.string().trim().min(1) });

function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new cockpit.CockpitError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return parsed.data;
}

router.get(
  '/status',
  handle(async (_req, res) => {
    res.json({
      sheets: !!getSheets(),
      agentPhone: config.AGENT_PHONE_NUMBER ? `…${config.AGENT_PHONE_NUMBER.slice(-4)}` : null,
      demoApp: !!config.TWILIO_DEMO_APP_SID,
      recordingAllowed: config.RECORD_SALES_CALLS,
      callingHours: config.CALLING_HOURS ?? DEFAULT_CALLING_HOURS,
      callingWindowOpen: cockpit.callingWindowOpen(),
      outcomes: CALL_OUTCOMES,
      statuses: PROSPECT_STATUSES,
      defaultStatusForOutcome: cockpit.DEFAULT_STATUS_FOR_OUTCOME,
    });
  })
);

router.get(
  '/queue',
  handle(async (_req, res) => {
    const sheets = getSheets();
    if (!sheets) throw new cockpit.CockpitError('Google Sheets sync is off', 503);
    const [prospects, doNotCall, demos] = await Promise.all([
      sheets.getProspects(),
      sheets.getDoNotCall(),
      db.business.findMany({ where: { mode: 'DEMO' }, select: { slug: true, updatedAt: true } }),
    ]);
    const demoSlugs = new Map(demos.map((d) => [d.slug, d.updatedAt]));
    const queue = cockpit.buildQueue(prospects, doNotCall, cockpit.ukToday()).map((p) => ({
      ...p,
      demoUpdatedAt: demoSlugs.get(slugify(p.pubName)) ?? null,
    }));
    res.json({ queue, totalProspects: prospects.length });
  })
);

router.post(
  '/demo',
  handle(async (req, res) => {
    const { pubName } = parseBody(pubNameBody, req.body);
    const sheets = getSheets();
    if (!sheets) throw new cockpit.CockpitError('Google Sheets sync is off', 503);
    const prospect = await sheets.findProspect(pubName);
    if (!prospect) throw new cockpit.CockpitError(`"${pubName}" isn't in the Prospects tab`, 404);
    const notes = prospectNotes(prospect);
    if (!notes) throw new cockpit.CockpitError('Add research notes, an address or a booking system to the sheet first');
    const draft = await buildDemoDraft(prospect.pubName, notes);
    try {
      const { slug, created } = await saveDemo(prospect.pubName, config.PERSONA_NAME, draft);
      res.json({ slug, created, draft });
    } catch (err) {
      throw new cockpit.CockpitError((err as Error).message, 409);
    }
  })
);

router.post(
  '/call',
  handle(async (req, res) => {
    const { pubName } = parseBody(pubNameBody, req.body);
    res.json(await cockpit.startCall(pubName));
  })
);

router.get('/session', (_req, res) => {
  res.json({ session: cockpit.getSession() ?? null });
});

router.post('/session/demo', handle(async (_req, res) => res.json(await cockpit.bringInDemo())));
router.delete('/session/demo', handle(async (_req, res) => res.json(await cockpit.removeDemo())));
router.post('/session/record', handle(async (_req, res) => res.json(await cockpit.startRecording())));
router.post('/session/hangup', handle(async (_req, res) => res.json(await cockpit.hangUp())));

router.post(
  '/session/mute',
  handle(async (req, res) => {
    const { muted } = parseBody(z.object({ muted: z.boolean() }), req.body);
    res.json(await cockpit.setMuted(muted));
  })
);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((d) => new Date(`${d}T12:00:00Z`));
const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => v || undefined);

const outcomeBody = z.object({
  outcome: z.enum(CALL_OUTCOMES),
  status: z.enum(PROSPECT_STATUSES).optional(),
  spokeTo: optionalText,
  reachedDecisionMaker: z.boolean().optional(),
  demoReaction: z.number().int().min(1).max(5).optional(),
  mainObjection: optionalText,
  nextStep: optionalText,
  followUpDate: isoDate.optional(),
  notes: optionalText,
});

router.post(
  '/session/outcome',
  handle(async (req, res) => {
    res.json(await cockpit.saveOutcome(parseBody(outcomeBody, req.body)));
  })
);

router.delete(
  '/session',
  handle(async (_req, res) => {
    cockpit.discardSession();
    res.sendStatus(204);
  })
);

export default router;
