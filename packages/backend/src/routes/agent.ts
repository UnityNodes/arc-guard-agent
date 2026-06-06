import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { runTreasuryAutopilot } from '../services/autopilot';
import { getAgentCard, registerAgentIdentity, getIdentityStatus } from '../services/arcIdentity';
import { logAudit } from '../services/audit';
import { logger } from '../lib/logger';

export const agentRouter = Router();

// Public ERC-8004 agent card (resolvable agentURI for the on-chain identity).
agentRouter.get('/card', (_req: Request, res: Response) => {
  res.json(getAgentCard());
});

function requireBotSecret(req: Request, res: Response, next: NextFunction): void {
  if (req.headers['x-bot-secret'] !== process.env.BOT_SHARED_SECRET || !process.env.BOT_SHARED_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

agentRouter.post('/pending-tx/:id/execute', requireBotSecret, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const tx = await prisma.agentTransaction.findUnique({ where: { id } });
    if (!tx || tx.status !== 'PENDING_APPROVAL') {
      res.status(404).json({ error: 'Pending transaction not found or already processed' });
      return;
    }
    if (!tx.toAddress) {
      res.status(400).json({ error: 'Transaction has no destination address' });
      return;
    }
    const wallet = await prisma.agentWallet.findUnique({
      where: { userId: tx.userId },
      select: { circleWalletId: true, isActive: true },
    });
    if (!wallet?.circleWalletId || !wallet.isActive) {
      res.status(400).json({ error: 'Agent wallet not configured or disabled' });
      return;
    }
    let txHash: string | null = null;
    let network: string = tx.network;

    if (tx.type === 'WITHDRAW') {
      if (!tx.toAddress) { res.status(400).json({ error: 'Transaction has no destination address' }); return; }
      const { withdrawFromAgentWallet } = await import('../services/arckit');
      const out = await withdrawFromAgentWallet(wallet.circleWalletId, tx.tokenIn, parseFloat(tx.amount), tx.toAddress);
      txHash = out.txHash || null;
      network = out.network;
    } else if (tx.type === 'EARN_DEPOSIT') {
      const { earnDeposit } = await import('../services/arcEarn');
      const out = await earnDeposit(wallet.circleWalletId, tx.amount);
      txHash = out.txHash || null;
    } else if (tx.type === 'EARN_WITHDRAW') {
      const { earnWithdraw } = await import('../services/arcEarn');
      const out = await earnWithdraw(wallet.circleWalletId, tx.amount);
      txHash = out.txHash || null;
    } else if (tx.type === 'GATEWAY_DEPOSIT') {
      const { gatewayDeposit } = await import('../services/arcGateway');
      const out = await gatewayDeposit(wallet.circleWalletId, tx.amount);
      txHash = out.txHash || null;
    } else if (tx.type === 'GATEWAY_SPEND') {
      const parts = (tx.toAddress || '|').split('|');
      const toChain = parts[0] || '';
      const recipient = parts[1] || '';
      if (!toChain || !recipient) { res.status(400).json({ error: 'Invalid gateway_spend params' }); return; }
      const { gatewaySpend } = await import('../services/arcGateway');
      const out = await gatewaySpend(wallet.circleWalletId, toChain, recipient, tx.amount);
      txHash = out.txHash || null;
    } else {
      res.status(400).json({ error: `Unknown pending transaction type: ${tx.type}` }); return;
    }

    await prisma.agentTransaction.update({
      where: { id },
      data: { status: 'SUCCESS', txHash },
    });
    await logAudit({
      userId: tx.userId,
      actor: 'user',
      action: `${tx.type}_APPROVED`,
      detail: { amount: tx.amount, token: tx.tokenIn, toAddress: tx.toAddress, txHash },
    });
    res.json({ success: true, txHash, amount: `${tx.amount} ${tx.tokenIn}`, toAddress: tx.toAddress, network });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('agent', 'pending-tx execute failed', err);
    await prisma.agentTransaction.update({ where: { id }, data: { status: 'FAILED' } }).catch(() => {});
    res.status(502).json({ error: msg });
  }
});

agentRouter.post('/pending-tx/:id/reject', requireBotSecret, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const tx = await prisma.agentTransaction.findUnique({ where: { id } });
    if (!tx || tx.status !== 'PENDING_APPROVAL') {
      res.status(404).json({ error: 'Pending transaction not found or already processed' });
      return;
    }
    await prisma.agentTransaction.update({ where: { id }, data: { status: 'REJECTED' } });
    await logAudit({
      userId: tx.userId,
      actor: 'user',
      action: 'TRANSFER_REJECTED',
      detail: { amount: tx.amount, token: tx.tokenIn, toAddress: tx.toAddress },
    });
    res.json({ success: true });
  } catch (err) {
    logger.error('agent', 'pending-tx reject failed', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Reject failed' });
  }
});

agentRouter.use(requireAuth);

const schema = z.object({ bufferUsd: z.number().nonnegative().max(1_000_000).optional() });

agentRouter.post('/autopilot', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = schema.safeParse(req.body ?? {});
  const bufferUsd = parsed.success ? parsed.data.bufferUsd ?? 2 : 2;
  try {
    const result = await runTreasuryAutopilot(req.userId!, bufferUsd);
    res.json({ result });
  } catch (err) {
    logger.error('autopilot', 'run failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Autopilot failed' });
  }
});

agentRouter.get('/identity', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json(await getIdentityStatus(req.userId!));
  } catch (err) {
    logger.error('identity', 'status failed', err);
    res.status(500).json({ error: 'Failed to read identity' });
  }
});

agentRouter.get('/audit', async (req: AuthRequest, res: Response): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  try {
    const logs = await prisma.auditLog.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, action: true, detail: true, actor: true, createdAt: true },
    });
    res.json({ logs });
  } catch (err) {
    logger.error('agent', 'audit fetch failed', err);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

agentRouter.get('/learning', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { getLearningStats, getPopularPairs } = await import('../services/agentLearning');
    const [stats, popularPairs] = await Promise.all([
      getLearningStats(),
      getPopularPairs(8),
    ]);
    res.json({ ...stats, popularPairs });
  } catch (err) {
    logger.error('agent', 'learning stats failed', err);
    res.status(500).json({ error: 'Failed to read learning stats' });
  }
});

agentRouter.post('/register-identity', async (req: AuthRequest, res: Response): Promise<void> => {
  const wallet = await prisma.agentWallet.findUnique({ where: { userId: req.userId! }, select: { circleWalletId: true, isActive: true } });
  if (!wallet?.circleWalletId) { res.status(400).json({ error: 'Agent wallet not configured' }); return; }
  if (!wallet.isActive) { res.status(403).json({ error: 'Agent wallet disabled' }); return; }
  try {
    const result = await registerAgentIdentity(wallet.circleWalletId, req.userId!);
    res.json({ result });
  } catch (err) {
    logger.error('identity', 'register failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Register failed' });
  }
});
