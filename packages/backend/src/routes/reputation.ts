import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import {
  giveAgentFeedback,
  listAgentFeedback,
  summarizeAgentReputation,
} from '../services/arcReputation';

export const reputationRouter = Router();

const agentIdSchema = z.object({ agentId: z.string().regex(/^\d+$/, 'agentId must be a positive integer') });

reputationRouter.get('/:agentId/summary', async (req, res: Response): Promise<void> => {
  const parsed = agentIdSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid agentId' });
    return;
  }
  try {
    const summary = await summarizeAgentReputation(parsed.data.agentId);
    res.json(summary);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Summary failed' });
  }
});

reputationRouter.get('/:agentId/feedback', async (req, res: Response): Promise<void> => {
  const parsed = agentIdSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid agentId' });
    return;
  }
  const max = Math.min(parseInt(String(req.query.max ?? '50'), 10) || 50, 200);
  try {
    const records = await listAgentFeedback(parsed.data.agentId, max);
    res.json({ agentId: parsed.data.agentId, count: records.length, feedback: records });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'List failed' });
  }
});

const feedbackBody = z.object({
  targetAgentId: z.string().regex(/^\d+$/),
  score: z.number().int().min(-100).max(100),
  tag: z.string().min(1).max(80),
  feedbackType: z.number().int().min(0).max(255).optional(),
  metadataURI: z.string().max(500).optional(),
  evidenceURI: z.string().max(500).optional(),
  comment: z.string().max(1000).optional(),
});

reputationRouter.post('/feedback', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = feedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' });
    return;
  }
  const wallet = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { circleWalletId: true, agentAddress: true, isActive: true },
  });
  if (!wallet?.circleWalletId || !wallet.agentAddress) {
    res.status(400).json({ error: 'Agent wallet not configured' });
    return;
  }
  if (!wallet.isActive) {
    res.status(400).json({ error: 'Agent wallet disabled' });
    return;
  }
  try {
    const result = await giveAgentFeedback({
      walletId: wallet.circleWalletId,
      walletAddress: wallet.agentAddress,
      ...parsed.data,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Feedback submission failed' });
  }
});
