import { evaluate, GuardianPolicy, GuardianRequest, GuardianResult } from '@guardagent/guardian';
import { prisma } from '../lib/prisma';

export async function buildPolicyForUser(userId: string): Promise<GuardianPolicy> {
  const wallet = await prisma.agentWallet.findUnique({
    where: { userId },
    select: { maxTxSizeUsd: true, dailyLimitUsd: true, approvalThresholdUsd: true, slippagePercent: true, allowedTokens: true, blockedTokens: true },
  });

  const memberships = await prisma.orgMembership.findMany({
    where: { userId },
    include: { org: { select: { id: true, approvalThresholdUsd: true } } },
  });

  const policy: GuardianPolicy = {};
  if (wallet) {
    policy.perTxUsd = wallet.maxTxSizeUsd;
    policy.dailyUsd = wallet.dailyLimitUsd;
    policy.maxSlippageBps = Math.round(wallet.slippagePercent * 100);
    if (wallet.allowedTokens && wallet.allowedTokens.length > 0) policy.allowTokens = wallet.allowedTokens;
    if (wallet.blockedTokens && wallet.blockedTokens.length > 0) policy.denyTokens = wallet.blockedTokens;
    if (wallet.approvalThresholdUsd != null) policy.approvalThresholdUsd = wallet.approvalThresholdUsd;
  }
  if (memberships.length > 0) {
    const minThreshold = memberships
      .map((m) => m.org.approvalThresholdUsd)
      .reduce((min, v) => (v < min ? v : min), Number.POSITIVE_INFINITY);
    if (Number.isFinite(minThreshold)) {
      policy.approvalThresholdUsd = policy.approvalThresholdUsd != null
        ? Math.min(policy.approvalThresholdUsd, minThreshold)
        : minThreshold;
    }
  }
  return policy;
}

export async function pickOrgForApproval(userId: string): Promise<string | null> {
  const memberships = await prisma.orgMembership.findMany({
    where: { userId, role: { in: ['SIGNER', 'ADMIN', 'OWNER'] } },
    include: { org: { select: { id: true, approvalThresholdUsd: true } } },
  });
  if (memberships.length === 0) return null;
  const strictest = memberships.reduce((a, b) =>
    a.org.approvalThresholdUsd <= b.org.approvalThresholdUsd ? a : b,
  );
  return strictest.org.id;
}

export async function spentTodayUsd(userId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.agentTransaction.findMany({
    where: { userId, status: 'SUCCESS', createdAt: { gte: start } },
    select: { amountUsd: true },
  });
  return rows.reduce((s, r) => s + (r.amountUsd ?? 0), 0);
}

export async function evaluateAction(userId: string, request: GuardianRequest): Promise<{ policy: GuardianPolicy; spentTodayUsd: number; result: GuardianResult }> {
  const policy = await buildPolicyForUser(userId);
  const spent = await spentTodayUsd(userId);
  const result = evaluate(policy, { ...request, spentTodayUsd: request.spentTodayUsd ?? spent });
  return { policy, spentTodayUsd: spent, result };
}
