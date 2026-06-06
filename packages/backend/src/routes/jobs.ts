import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import {
  createJob,
  setJobBudget,
  approveUsdcForJobs,
  fundJob,
  submitDeliverable,
  completeJob,
  getOnChainJob,
  bytes32FromText,
  JOB_STATUS_NAMES,
} from '../services/arcJobs';
import { logger } from '../lib/logger';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

// Map ERC-8183 on-chain status indices to our DB status strings
const STATUS_FROM_ONCHAIN: Record<number, string> = {
  0: 'OPEN',
  1: 'FUNDED',
  2: 'SUBMITTED',
  3: 'COMPLETED',
  4: 'REJECTED',
  5: 'EXPIRED',
};

async function loadUserWallet(userId: string) {
  return prisma.agentWallet.findUnique({
    where: { userId },
    select: { circleWalletId: true, agentAddress: true, isActive: true },
  });
}

function assertWalletReady(wallet: { circleWalletId: string | null; agentAddress: string | null; isActive: boolean } | null) {
  if (!wallet?.circleWalletId || !wallet.agentAddress) return 'Agent wallet not configured';
  if (!wallet.isActive) return 'Agent wallet disabled';
  return null;
}

// ─── List ──────────────────────────────────────────────────────────────

jobsRouter.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const wallet = await loadUserWallet(req.userId!);
  const myAddress = wallet?.agentAddress?.toLowerCase() ?? '';

  // Show jobs where the user is client, provider, or evaluator (by agent address) OR userId-owned
  const jobs = await prisma.job.findMany({
    where: {
      OR: [
        { userId: req.userId! },
        ...(myAddress ? [
          { clientAddress: { equals: myAddress, mode: 'insensitive' as const } },
          { providerAddress: { equals: myAddress, mode: 'insensitive' as const } },
          { evaluatorAddress: { equals: myAddress, mode: 'insensitive' as const } },
        ] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({ jobs, myAddress });
});

// ─── Get one (with live on-chain status) ───────────────────────────────

jobsRouter.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  let onChain = null;
  if (job.jobId) {
    onChain = await getOnChainJob(job.jobId);
  }
  res.json({ job, onChain });
});

// ─── Create draft (off-chain, just DB) ─────────────────────────────────

const createDraftSchema = z.object({
  providerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  evaluatorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  description: z.string().min(1).max(500),
  expiredAtSec: z.number().int().positive(),
  hookAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

jobsRouter.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = createDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' });
    return;
  }
  const wallet = await loadUserWallet(req.userId!);
  const err = assertWalletReady(wallet);
  if (err) { res.status(400).json({ error: err }); return; }

  const job = await prisma.job.create({
    data: {
      userId: req.userId!,
      role: 'CLIENT',
      status: 'DRAFT',
      clientAddress: wallet!.agentAddress!,
      providerAddress: parsed.data.providerAddress,
      evaluatorAddress: parsed.data.evaluatorAddress,
      hookAddress: parsed.data.hookAddress ?? '0x0000000000000000000000000000000000000000',
      description: parsed.data.description,
      expiredAt: new Date(parsed.data.expiredAtSec * 1000),
    },
  });
  res.json(job);
});

// ─── On-chain createJob (client signs) ─────────────────────────────────

jobsRouter.post('/:id/create-onchain', async (req: AuthRequest, res: Response): Promise<void> => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job || job.userId !== req.userId) { res.status(404).json({ error: 'Job not found' }); return; }
  if (job.status !== 'DRAFT') { res.status(400).json({ error: `Cannot create-onchain from status ${job.status}` }); return; }

  const wallet = await loadUserWallet(req.userId!);
  const err = assertWalletReady(wallet);
  if (err) { res.status(400).json({ error: err }); return; }
  if (wallet!.agentAddress!.toLowerCase() !== job.clientAddress.toLowerCase()) {
    res.status(403).json({ error: 'Only the named client can create this job on-chain' });
    return;
  }

  try {
    const r = await createJob({
      walletId: wallet!.circleWalletId!,
      walletAddress: wallet!.agentAddress!,
      providerAddress: job.providerAddress,
      evaluatorAddress: job.evaluatorAddress,
      expiredAtSec: Math.floor(job.expiredAt.getTime() / 1000),
      description: job.description,
      hook: job.hookAddress,
    });
    const updated = await prisma.job.update({
      where: { id: job.id },
      data: { jobId: r.jobId, createTxHash: r.txHash, status: 'OPEN' },
    });
    res.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'createJob failed';
    await prisma.job.update({ where: { id: job.id }, data: { error: msg } }).catch(() => {});
    res.status(400).json({ error: msg });
  }
});

// ─── setBudget (provider signs) ────────────────────────────────────────

const setBudgetSchema = z.object({ amountUsdc: z.number().positive() });

jobsRouter.post('/:id/set-budget', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = setBudgetSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'amountUsdc must be a positive number' }); return; }
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  if (!job.jobId) { res.status(400).json({ error: 'Job not yet on-chain' }); return; }

  const wallet = await loadUserWallet(req.userId!);
  const err = assertWalletReady(wallet);
  if (err) { res.status(400).json({ error: err }); return; }
  if (wallet!.agentAddress!.toLowerCase() !== job.providerAddress.toLowerCase()) {
    res.status(403).json({ error: 'Only the named provider can set the budget' });
    return;
  }

  try {
    const r = await setJobBudget(wallet!.circleWalletId!, job.jobId, parsed.data.amountUsdc);
    const updated = await prisma.job.update({
      where: { id: job.id },
      data: { budgetUsdc: String(parsed.data.amountUsdc), budgetTxHash: r.txHash },
    });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'setBudget failed' });
  }
});

// ─── approve USDC + fund (client signs) ────────────────────────────────

jobsRouter.post('/:id/fund', async (req: AuthRequest, res: Response): Promise<void> => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  if (!job.jobId) { res.status(400).json({ error: 'Job not yet on-chain' }); return; }
  if (!job.budgetUsdc) { res.status(400).json({ error: 'Provider has not set budget yet' }); return; }

  const wallet = await loadUserWallet(req.userId!);
  const err = assertWalletReady(wallet);
  if (err) { res.status(400).json({ error: err }); return; }
  if (wallet!.agentAddress!.toLowerCase() !== job.clientAddress.toLowerCase()) {
    res.status(403).json({ error: 'Only the named client can fund this job' });
    return;
  }

  try {
    // Two on-chain txs: approve, then fund.
    const approveResult = await approveUsdcForJobs(wallet!.circleWalletId!, job.budgetUsdc);
    logger.info('jobs', `Job ${job.id}: USDC approve ${approveResult.txHash}`);
    const fundResult = await fundJob(wallet!.circleWalletId!, job.jobId);
    const updated = await prisma.job.update({
      where: { id: job.id },
      data: { fundTxHash: fundResult.txHash, status: 'FUNDED' },
    });
    res.json({ ...updated, approveTxHash: approveResult.txHash });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'fund failed' });
  }
});

// ─── submit deliverable (provider signs) ───────────────────────────────

const submitSchema = z.object({
  deliverableText: z.string().min(1).max(500).optional(),
  deliverableHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
}).refine((d) => d.deliverableText || d.deliverableHash, {
  message: 'Provide either deliverableText (we hash it) or deliverableHash (32-byte hex)',
});

jobsRouter.post('/:id/submit', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }); return; }
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  if (!job.jobId) { res.status(400).json({ error: 'Job not yet on-chain' }); return; }
  if (job.status !== 'FUNDED') { res.status(400).json({ error: `Cannot submit from status ${job.status}; expected FUNDED` }); return; }

  const wallet = await loadUserWallet(req.userId!);
  const err = assertWalletReady(wallet);
  if (err) { res.status(400).json({ error: err }); return; }
  if (wallet!.agentAddress!.toLowerCase() !== job.providerAddress.toLowerCase()) {
    res.status(403).json({ error: 'Only the named provider can submit a deliverable' });
    return;
  }

  const hash = parsed.data.deliverableHash ?? bytes32FromText(parsed.data.deliverableText!);
  try {
    const r = await submitDeliverable(wallet!.circleWalletId!, job.jobId, hash);
    const updated = await prisma.job.update({
      where: { id: job.id },
      data: { deliverableHash: hash, submitTxHash: r.txHash, status: 'SUBMITTED' },
    });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'submit failed' });
  }
});

// ─── complete (evaluator signs) ────────────────────────────────────────

const completeSchema = z.object({
  reasonText: z.string().min(1).max(500).optional(),
  reasonHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
}).refine((d) => d.reasonText || d.reasonHash, {
  message: 'Provide either reasonText (we hash it) or reasonHash (32-byte hex)',
});

jobsRouter.post('/:id/complete', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }); return; }
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  if (!job.jobId) { res.status(400).json({ error: 'Job not yet on-chain' }); return; }
  if (job.status !== 'SUBMITTED') { res.status(400).json({ error: `Cannot complete from status ${job.status}; expected SUBMITTED` }); return; }

  const wallet = await loadUserWallet(req.userId!);
  const err = assertWalletReady(wallet);
  if (err) { res.status(400).json({ error: err }); return; }
  if (wallet!.agentAddress!.toLowerCase() !== job.evaluatorAddress.toLowerCase()) {
    res.status(403).json({ error: 'Only the named evaluator can complete this job' });
    return;
  }

  const hash = parsed.data.reasonHash ?? bytes32FromText(parsed.data.reasonText!);
  try {
    const r = await completeJob(wallet!.circleWalletId!, job.jobId, hash);
    const updated = await prisma.job.update({
      where: { id: job.id },
      data: { reasonHash: hash, completeTxHash: r.txHash, status: 'COMPLETED' },
    });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'complete failed' });
  }
});

// ─── Public read of any on-chain job by jobId ──────────────────────────

jobsRouter.get('/onchain/:jobId', async (req: AuthRequest, res: Response): Promise<void> => {
  const jobId = req.params.jobId;
  if (!/^\d+$/.test(jobId)) { res.status(400).json({ error: 'jobId must be a positive integer' }); return; }
  const onChain = await getOnChainJob(jobId);
  if (!onChain) { res.status(404).json({ error: 'Job not found on-chain' }); return; }
  res.json({ onChain, statusNames: JOB_STATUS_NAMES });
});
