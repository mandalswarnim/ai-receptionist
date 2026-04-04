/**
 * Admin REST API for viewing and managing call records.
 *
 * GET    /api/calls                    — List all calls (paginated)
 * GET    /api/calls/:id                — Get a single call with turns
 * GET    /api/calls/:id/transcript     — Get full transcript
 * DELETE /api/calls/:id                — Delete a call record
 * GET    /api/calls/stats              — Summary statistics
 * GET    /api/health                   — Health check
 */

import { Router, Request, Response } from 'express';
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';
import { getActiveSessionCount } from '../../services/conversation.service';

const router = Router();

// ─── Health check ────────────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    activeCalls: getActiveSessionCount(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Statistics ──────────────────────────────────────────────────────────────

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [total, byStatus, byUrgency, avgDuration] = await Promise.all([
      db.call.count(),
      db.call.groupBy({ by: ['status'], _count: true }),
      db.call.groupBy({ by: ['urgency'], _count: true, where: { urgency: { not: null } } }),
      db.call.aggregate({ _avg: { duration: true }, where: { duration: { not: null } } }),
    ]);

    res.json({
      total,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
      byUrgency: Object.fromEntries(byUrgency.map((r) => [r.urgency!, r._count])),
      avgDurationSeconds: Math.round(avgDuration._avg.duration ?? 0),
      activeCalls: getActiveSessionCount(),
    });
  } catch (err) {
    logger.error('Stats query failed', { err });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── List calls ──────────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 20));
  const status = req.query['status'] as string | undefined;
  const urgency = req.query['urgency'] as string | undefined;
  const search = req.query['search'] as string | undefined;

  const safeSearch = Array.isArray(search) ? search[0] : search;
  const where = {
    ...(status && { status: status.toUpperCase() as 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' | 'NO_ANSWER' }),
    ...(urgency && { urgency: urgency.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' }),
    ...(safeSearch && {
      OR: [
        { callerName: { contains: safeSearch, mode: 'insensitive' as const } },
        { callerPhone: { contains: safeSearch } },
        { callerEmail: { contains: safeSearch, mode: 'insensitive' as const } },
        { callerCompany: { contains: safeSearch, mode: 'insensitive' as const } },
      ],
    }),
  };

  try {
    const [calls, count] = await Promise.all([
      db.call.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          callSid: true,
          from: true,
          status: true,
          callerName: true,
          callerCompany: true,
          callerPhone: true,
          urgency: true,
          summary: true,
          duration: true,
          emailSent: true,
          startedAt: true,
          endedAt: true,
        },
      }),
      db.call.count({ where }),
    ]);

    res.json({
      data: calls,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    logger.error('List calls query failed', { err });
    res.status(500).json({ error: 'Failed to fetch calls' });
  }
});

// ─── Get single call ─────────────────────────────────────────────────────────

router.get('/:id', async (req: Request, res: Response) => {
  const id = String(req.params['id']);

  try {
    const call = await db.call.findFirst({
      where: { OR: [{ id: id }, { callSid: id }] },
      include: {
        turns: { orderBy: { sequence: 'asc' } },
      },
    });

    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    res.json(call);
  } catch (err) {
    logger.error('Get call failed', { id, err });
    res.status(500).json({ error: 'Failed to fetch call' });
  }
});

// ─── Get transcript ───────────────────────────────────────────────────────────

router.get('/:id/transcript', async (req: Request, res: Response) => {
  const id = String(req.params['id']);

  try {
    const call = await db.call.findFirst({
      where: { OR: [{ id: id }, { callSid: id }] },
      include: {
        turns: { orderBy: { sequence: 'asc' } },
      },
    });

    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    res.json({
      transcript: call.transcript,
      turns: call.turns,
    });
  } catch (err) {
    logger.error('Get transcript failed', { id, err });
    res.status(500).json({ error: 'Failed to fetch transcript' });
  }
});

// ─── Delete call ─────────────────────────────────────────────────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  const id = String(req.params['id']);

  try {
    const call = await db.call.findFirst({
      where: { OR: [{ id: id }, { callSid: id }] },
    });

    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    await db.call.delete({ where: { id: call.id } });
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete call failed', { id, err });
    res.status(500).json({ error: 'Failed to delete call' });
  }
});

export default router;
