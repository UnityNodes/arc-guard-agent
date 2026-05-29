import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getAegisStatus, getAegisWallets, searchAegisServices, aegisPay } from '../services/aegisWallet';
import { logAudit } from '../services/audit';
import { logger } from '../lib/logger';

export const aegisRouter = Router();
aegisRouter.use(requireAuth);

aegisRouter.get('/status', async (_req: AuthRequest, res: Response): Promise<void> => {
  try { res.json(await getAegisStatus()); }
  catch (err) { res.status(502).json({ error: err instanceof Error ? err.message : 'failed' }); }
});

aegisRouter.get('/wallets', async (_req: AuthRequest, res: Response): Promise<void> => {
  try { res.json({ wallets: await getAegisWallets() }); }
  catch (err) { res.status(502).json({ error: err instanceof Error ? err.message : 'failed' }); }
});

aegisRouter.get('/services/search', async (req: AuthRequest, res: Response): Promise<void> => {
  const keyword = String(req.query.keyword || '').trim();
  if (!keyword) { res.status(400).json({ error: 'keyword query param required' }); return; }
  try { res.json({ services: await searchAegisServices(keyword) }); }
  catch (err) { res.status(502).json({ error: err instanceof Error ? err.message : 'failed' }); }
});

const paySchema = z.object({
  serviceUrl: z.string().url(),
  chain: z.string().optional(),
  method: z.enum(['GET', 'POST']).optional(),
  data: z.any().optional(),
  maxAmount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
});

aegisRouter.post('/pay', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = paySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const result = await aegisPay(parsed.data.serviceUrl, {
      chain: parsed.data.chain,
      method: parsed.data.method,
      data: parsed.data.data,
      maxAmount: parsed.data.maxAmount,
    });
    await logAudit({
      actor: `user:${req.userId ?? 'unknown'}`,
      action: result.ok ? 'AEGIS_PAY_OK' : 'AEGIS_PAY_FAIL',
      detail: { serviceUrl: parsed.data.serviceUrl, cost: result.cost, txHash: result.txHash, error: result.error },
    });
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    logger.error('aegis', 'pay failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'failed' });
  }
});
