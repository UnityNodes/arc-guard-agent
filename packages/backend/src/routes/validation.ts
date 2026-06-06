import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import {
  getValidationStatus,
  requestValidation,
  submitValidationResponse,
} from '../services/arcValidation';

export const validationRouter = Router();

const requestHashSchema = z.object({
  requestHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'requestHash must be a 0x-prefixed 32-byte hex string'),
});

validationRouter.get('/:requestHash', async (req, res: Response): Promise<void> => {
  const parsed = requestHashSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid requestHash' });
    return;
  }
  try {
    const status = await getValidationStatus(parsed.data.requestHash);
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Status lookup failed' });
  }
});

const requestBody = z.object({
  validatorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  agentId: z.string().regex(/^\d+$/),
  requestURI: z.string().max(500).optional(),
  requestHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  requestText: z.string().max(500).optional(),
});

validationRouter.post('/request', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = requestBody.safeParse(req.body);
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
    const result = await requestValidation({
      walletId: wallet.circleWalletId,
      walletAddress: wallet.agentAddress,
      ...parsed.data,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Validation request failed' });
  }
});

const respondBody = z.object({
  requestHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  response: z.number().int().min(0).max(255),
  tag: z.string().min(1).max(80),
  responseURI: z.string().max(500).optional(),
  responseHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  responseText: z.string().max(500).optional(),
});

validationRouter.post('/respond', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = respondBody.safeParse(req.body);
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
    const result = await submitValidationResponse({
      walletId: wallet.circleWalletId,
      walletAddress: wallet.agentAddress,
      ...parsed.data,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Validation response failed' });
  }
});
