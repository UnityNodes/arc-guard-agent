import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

// GET /api/alerts
alertsRouter.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

  const [alerts, total] = await Promise.all([
    prisma.alert.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { rule: { select: { name: true, token: true, tokenSymbol: true } } },
    }),
    prisma.alert.count({ where: { userId: req.userId! } }),
  ]);

  res.json({ alerts, total, limit, offset });
});

// POST /api/alerts/:id/acknowledge
alertsRouter.post('/:id/acknowledge', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  const alert = await prisma.alert.findFirst({
    where: { id, userId: req.userId! },
  });
  if (!alert) {
    res.status(404).json({ error: 'Alert not found' });
    return;
  }

  const updated = await prisma.alert.update({
    where: { id },
    data: { status: 'ACKNOWLEDGED' },
  });
  res.json({ alert: updated });
});
