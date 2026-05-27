import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { buildPolicyForUser, evaluateAction, spentTodayUsd } from '../services/guardian';
import { logger } from '../lib/logger';

export const guardianRouter = Router();
guardianRouter.use(requireAuth);

const evalSchema = z.object({
  action:      z.enum(['WITHDRAW', 'SWAP', 'BRIDGE', 'GATEWAY_SPEND', 'TRANSFER', 'NANOPAY']),
  amountUsd:   z.number().nonnegative(),
  token:       z.string().max(20).optional(),
  destination: z.string().max(64).optional(),
  slippageBps: z.number().int().nonnegative().optional(),
});

guardianRouter.get('/policy', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [policy, spent] = await Promise.all([
      buildPolicyForUser(req.userId!),
      spentTodayUsd(req.userId!),
    ]);
    res.json({ policy, spentToday: spent });
  } catch (err) {
    logger.error('guardian', 'policy load failed', err);
    res.status(500).json({ error: 'Failed to load policy' });
  }
});

guardianRouter.post('/evaluate', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = evalSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const out = await evaluateAction(req.userId!, parsed.data);
    res.json(out);
  } catch (err) {
    logger.error('guardian', 'evaluate failed', err);
    res.status(500).json({ error: 'Evaluation failed' });
  }
});
