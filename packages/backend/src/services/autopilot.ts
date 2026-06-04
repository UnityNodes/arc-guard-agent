import { prisma } from '../lib/prisma';
import { getAgentBalance } from './arckit';
import { evaluateAction, pickOrgForApproval } from './guardian';
import { earnDeposit, claimEarnRewards } from './arcEarn';
import { createApprovalRequest } from './org';
import { logAudit } from './audit';
import { logger } from '../lib/logger';

export interface HarvestInfo {
  status: string;
  txHash?: string;
  explorerUrl?: string;
  rewards: { symbol: string; amount: string }[];
}

export interface AutopilotResult {
  action: 'DEPOSIT_EARN' | 'NONE' | 'BLOCKED' | 'NEEDS_APPROVAL' | 'APPROVAL_FILED';
  detail: string;
  txHash?: string;
  explorerUrl?: string;
  approvalId?: string;
  harvested?: HarvestInfo;
}

async function harvestRewards(userId: string, walletId: string): Promise<HarvestInfo | undefined> {
  try {
    const r = await claimEarnRewards(walletId);
    if (r.status !== 'claimed' || !r.txHash) return undefined;
    const rewards = r.rewards.map((x) => ({ symbol: x.symbol, amount: x.amount }));
    for (const reward of rewards) {
      await prisma.agentTransaction.create({
        data: { userId, type: 'EARN_CLAIM', tokenIn: reward.symbol || 'REWARD', tokenOut: reward.symbol || 'REWARD', amount: reward.amount, txHash: r.txHash, status: 'SUCCESS', network: 'arc-testnet' },
      }).catch(() => {});
    }
    await logAudit({ userId, actor: 'autopilot', action: 'AUTOPILOT_HARVEST', detail: { txHash: r.txHash, rewards } });
    return { status: r.status, txHash: r.txHash, explorerUrl: r.explorerUrl, rewards };
  } catch (err) {
    logger.warn('earn', 'autopilot harvest failed', err);
    return undefined;
  }
}

export async function runTreasuryAutopilot(userId: string, bufferUsd = 2): Promise<AutopilotResult> {
  const wallet = await prisma.agentWallet.findUnique({ where: { userId }, select: { circleWalletId: true, isActive: true } });
  if (!wallet?.circleWalletId) return { action: 'NONE', detail: 'No agent wallet configured' };
  if (!wallet.isActive) return { action: 'NONE', detail: 'Agent wallet is disabled' };

  const harvested = await harvestRewards(userId, wallet.circleWalletId);
  const harvestNote = harvested
    ? ` Harvested rewards first: ${harvested.rewards.map((x) => `${x.amount} ${x.symbol}`).join(', ') || 'claimed'}.`
    : '';
  const withHarvest = (r: AutopilotResult): AutopilotResult => (harvested ? { ...r, detail: r.detail + harvestNote, harvested } : r);

  const bal = await getAgentBalance(wallet.circleWalletId);
  const usdc = parseFloat(bal.usdc) || 0;
  const idle = usdc - bufferUsd;

  if (idle <= 0.5) {
    await logAudit({ userId, actor: 'autopilot', action: 'AUTOPILOT_SCAN', detail: { usdc, bufferUsd, decision: 'none' } });
    return withHarvest({ action: 'NONE', detail: `Idle USDC $${usdc.toFixed(2)} is within the $${bufferUsd} buffer - nothing to sweep.` });
  }

  const amount = idle.toFixed(2);
  const guard = await evaluateAction(userId, { action: 'TRANSFER', amountUsd: parseFloat(amount), token: 'USDC' });

  if (guard.result.decision === 'DENY') {
    await logAudit({ userId, actor: 'autopilot', action: 'AUTOPILOT_BLOCKED', detail: { amount, reasons: guard.result.reasons } });
    return withHarvest({ action: 'BLOCKED', detail: `Guardian blocked the sweep: ${guard.result.reasons.join('; ')}` });
  }
  if (guard.result.decision === 'REQUIRE_APPROVAL') {
    const orgId = await pickOrgForApproval(userId);
    if (!orgId) {
      await logAudit({ userId, actor: 'autopilot', action: 'AUTOPILOT_NEEDS_APPROVAL', detail: { amount, reasons: guard.result.reasons, note: 'no org membership found' } });
      return withHarvest({ action: 'NEEDS_APPROVAL', detail: `Sweeping $${amount} into yield needs an organization approval but you are not in any org.` });
    }
    try {
      const req = await createApprovalRequest({
        orgId,
        requestedById: userId,
        action: 'EARN_DEPOSIT',
        payload: { amount },
        amountUsd: parseFloat(amount),
      });
      await logAudit({ userId, orgId, actor: 'autopilot', action: 'AUTOPILOT_FILED_APPROVAL', detail: { amount, approvalId: req.id, reasons: guard.result.reasons } });
      return withHarvest({ action: 'APPROVAL_FILED', detail: `Sweeping $${amount} into yield filed for org approval (ID ${req.id}).`, approvalId: req.id });
    } catch (err) {
      await logAudit({ userId, actor: 'autopilot', action: 'AUTOPILOT_APPROVAL_FAILED', detail: { amount, error: err instanceof Error ? err.message : 'unknown' } });
      return withHarvest({ action: 'NEEDS_APPROVAL', detail: `Sweeping $${amount} needs approval but filing failed: ${err instanceof Error ? err.message : 'unknown'}` });
    }
  }

  const r = await earnDeposit(wallet.circleWalletId, amount);
  await prisma.agentTransaction.create({
    data: { userId, type: 'EARN_DEPOSIT', tokenIn: 'USDC', tokenOut: 'USDC', amount, amountUsd: parseFloat(amount), txHash: r.txHash, status: 'SUCCESS', network: 'arc-testnet' },
  }).catch(() => {});
  await logAudit({ userId, actor: 'autopilot', action: 'AUTOPILOT_SWEEP_EARN', detail: { amount, txHash: r.txHash } });
  return withHarvest({ action: 'DEPOSIT_EARN', detail: `Swept $${amount} idle USDC into the Earn vault to earn yield.`, txHash: r.txHash, explorerUrl: r.explorerUrl });
}
