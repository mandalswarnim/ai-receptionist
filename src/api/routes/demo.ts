/**
 * Admin API for the active demo (Bearer ADMIN_API_KEY): which DEMO business
 * answers calls to our number during a sales call.
 *
 * GET    /api/demo/active          — Show the active demo, if any
 * POST   /api/demo/active { slug } — Make a DEMO business active for 30 minutes
 * DELETE /api/demo/active          — Clear it
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';
import { requireAdminKey } from '../middleware';
import { clearActiveDemo, getActiveDemo, setActiveDemo } from '../../services/demo.service';

const router = Router();
router.use(requireAdminKey);

/** Who an active demo answers, so it's obvious when real callers could hear it. */
function audience() {
  return config.AGENT_PHONE_NUMBER
    ? { answers: 'calls from AGENT_PHONE_NUMBER only' }
    : {
        answers: 'every caller to the Twilio number',
        warning:
          'AGENT_PHONE_NUMBER is not set, so real forwarded calls will also hear this demo while it is active.',
      };
}

router.get('/active', async (_req: Request, res: Response) => {
  const demo = getActiveDemo();
  if (!demo) {
    res.json({ active: null });
    return;
  }
  try {
    const business = await db.business.findUnique({
      where: { id: demo.businessId },
      select: { slug: true, name: true },
    });
    res.json({ active: { ...business, expiresAt: demo.expiresAt }, ...audience() });
  } catch (err) {
    logger.error('Failed to fetch active demo', { err });
    res.status(500).json({ error: 'Failed to fetch active demo' });
  }
});

router.post('/active', async (req: Request, res: Response) => {
  const parsed = z.object({ slug: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Body must be { "slug": "<business slug>" }' });
    return;
  }
  try {
    const business = await db.business.findUnique({ where: { slug: parsed.data.slug } });
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    if (business.mode !== 'DEMO') {
      res.status(400).json({ error: 'Only DEMO businesses can be made the active demo' });
      return;
    }
    const demo = setActiveDemo(business.id);
    logger.info('Active demo set', { slug: business.slug, expiresAt: demo.expiresAt });
    res.json({ active: { slug: business.slug, name: business.name, expiresAt: demo.expiresAt }, ...audience() });
  } catch (err) {
    logger.error('Failed to set active demo', { err });
    res.status(500).json({ error: 'Failed to set active demo' });
  }
});

router.delete('/active', (_req: Request, res: Response) => {
  clearActiveDemo();
  logger.info('Active demo cleared');
  res.sendStatus(204);
});

export default router;
