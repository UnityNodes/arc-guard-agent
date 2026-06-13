import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createPublicClient, http, erc20Abi, getAddress } from 'viem';
import { arcTestnet } from '../lib/chains';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { logAudit } from '../services/audit';
import { evaluateAction } from '../services/guardian';
import { executeBridge } from '../services/arcBridge';

export const internalRouter = Router();

const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;
const ARC_RPC = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network/';

// ─── Internal shared secret auth ──────────────────────────────────────────
// Reuses BOT_SHARED_SECRET. Worker + bot are equally trusted backend services.
function requireInternalSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.BOT_SHARED_SECRET;
  if (!expected) { res.status(503).json({ error: 'Internal endpoints not configured' }); return; }
  const got = req.headers['x-internal-secret'];
  if (got !== expected) { res.status(401).json({ error: 'Invalid internal secret' }); return; }
  next();
}

internalRouter.use(requireInternalSecret);

// ─── GET /api/internal/usdc-balance?address=0x... ────────────────────────
// Worker uses this to check balance-triggered rules without needing viem itself.
internalRouter.get('/usdc-balance', async (req: Request, res: Response): Promise<void> => {
  const addr = String(req.query.address ?? '');
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    res.status(400).json({ error: 'address must be 0x...' });
    return;
  }
  try {
    const pc = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) });
    const baseUnits = await pc.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [getAddress(addr)],
    });
    const balance = (Number(baseUnits) / 1_000_000).toString();
    res.json({ address: addr, balanceUsdc: balance, baseUnits: baseUnits.toString() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'balance read failed' });
  }
});

// ─── POST /api/internal/rule-action/execute ──────────────────────────────
// Worker calls this after detecting a triggered rule with action != ALERT.
// Backend re-validates Guardian policy + dispatches the real on-chain action.
const ruleExecSchema = z.object({
  ruleId: z.string().min(1),
});

internalRouter.post('/rule-action/execute', async (req: Request, res: Response): Promise<void> => {
  const parsed = ruleExecSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'ruleId required' }); return; }

  const rule = await prisma.rule.findUnique({ where: { id: parsed.data.ruleId } });
  if (!rule) { res.status(404).json({ error: 'Rule not found' }); return; }
  if (!rule.isActive) { res.status(400).json({ error: 'Rule is paused' }); return; }
  if (rule.action === 'ALERT') { res.status(400).json({ error: 'ALERT rules do not need execution' }); return; }

  const wallet = await prisma.agentWallet.findUnique({
    where: { userId: rule.userId },
    select: { circleWalletId: true, agentAddress: true, isActive: true },
  });
  if (!wallet?.circleWalletId || !wallet.agentAddress) {
    res.status(400).json({ error: 'User has no agent wallet' });
    return;
  }
  if (!wallet.isActive) { res.status(400).json({ error: 'Agent wallet disabled' }); return; }

  // For now: only BRIDGE supported
  if (rule.action !== 'BRIDGE') {
    res.status(400).json({ error: `Unsupported action: ${rule.action}` });
    return;
  }

  const cfg = rule.actionConfig as { toChain?: string; amountUsdc?: string; destAddress?: string } | null;
  if (!cfg?.toChain || !cfg?.amountUsdc) {
    res.status(400).json({ error: 'BRIDGE rule missing toChain or amountUsdc in actionConfig' });
    return;
  }
  const amountNum = parseFloat(cfg.amountUsdc);
  if (!isFinite(amountNum) || amountNum <= 0) {
    res.status(400).json({ error: 'Invalid amountUsdc' });
    return;
  }

  // Guardian: this is autonomous, only ALLOW gets through. REQUIRE_APPROVAL or DENY
  // is logged and surfaces back so the worker can record an Alert instead.
  const guard = await evaluateAction(rule.userId, { action: 'BRIDGE', amountUsd: amountNum, token: 'USDC' });
  if (guard.result.decision !== 'ALLOW') {
    await logAudit({
      userId: rule.userId,
      actor: 'agent',
      action: 'RULE_BRIDGE_GATED',
      detail: { ruleId: rule.id, decision: guard.result.decision, reasons: guard.result.reasons },
    });
    res.status(202).json({
      executed: false,
      decision: guard.result.decision,
      reasons: guard.result.reasons,
    });
    return;
  }

  const destination = cfg.destAddress ?? wallet.agentAddress;

  try {
    const result = await executeBridge(
      wallet.circleWalletId,
      rule.userId,
      'arc-testnet',
      cfg.toChain,
      cfg.amountUsdc,
      destination,
      'FAST',
    );
    await prisma.rule.update({
      where: { id: rule.id },
      data: { lastTriggeredAt: new Date() },
    });
    await logAudit({
      userId: rule.userId,
      actor: 'agent',
      action: 'RULE_BRIDGE_EXECUTED',
      detail: { ruleId: rule.id, bridgeId: result.id, toChain: cfg.toChain, amountUsdc: cfg.amountUsdc, destAddress: destination },
    });
    logger.info('rules', `Autonomous bridge ${result.id} from rule ${rule.id} (${cfg.amountUsdc} USDC → ${cfg.toChain})`);
    res.json({
      executed: true,
      bridgeId: result.id,
      toChain: cfg.toChain,
      amountUsdc: cfg.amountUsdc,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'bridge execution failed';
    logger.error('rules', `Autonomous bridge from rule ${rule.id} failed: ${msg}`);
    await logAudit({
      userId: rule.userId,
      actor: 'agent',
      action: 'RULE_BRIDGE_FAILED',
      detail: { ruleId: rule.id, error: msg },
    });
    res.status(500).json({ executed: false, error: msg });
  }
});
