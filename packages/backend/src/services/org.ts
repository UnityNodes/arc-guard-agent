import { prisma } from '../lib/prisma';
import { withdrawFromAgentWallet } from './arckit';
import { executeFxSwap } from './arcFx';
import { earnDeposit } from './arcEarn';
import { gatewaySpend } from './arcGateway';
import { logAudit } from './audit';
import { evaluateAction } from './guardian';
import type { GuardianAction } from '@guardagent/guardian';

export type OrgRole = 'OWNER' | 'ADMIN' | 'SIGNER' | 'VIEWER';
const RANK: Record<OrgRole, number> = { VIEWER: 0, SIGNER: 1, ADMIN: 2, OWNER: 3 };

export type ApprovableAction = 'WITHDRAW' | 'SWAP' | 'EARN_DEPOSIT' | 'GATEWAY_SPEND';

interface WithdrawPayload { token: string; amount: string; toAddress: string }
interface SwapPayload { fromToken: string; toToken: string; amount: string }
interface EarnDepositPayload { amount: string }
interface GatewaySpendPayload { toChain: string; amount: string; recipient: string }
type ApprovalPayload = WithdrawPayload | SwapPayload | EarnDepositPayload | GatewaySpendPayload;

export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return RANK[role] >= RANK[min];
}

export async function getMembership(orgId: string, userId: string) {
  return prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
}

export async function createOrganization(userId: string, name: string) {
  const org = await prisma.organization.create({
    data: {
      name,
      ownerId: userId,
      members: { create: { userId, role: 'OWNER' } },
    },
    include: { members: true },
  });
  await logAudit({ orgId: org.id, userId, actor: userId, action: 'ORG_CREATED', detail: { name } });
  return org;
}

export async function listMyOrganizations(userId: string) {
  const memberships = await prisma.orgMembership.findMany({
    where: { userId },
    include: { org: { include: { _count: { select: { members: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  return memberships.map((m) => ({
    id: m.org.id,
    name: m.org.name,
    role: m.role,
    members: m.org._count.members,
    approvalThresholdUsd: m.org.approvalThresholdUsd,
    requiredApprovals: m.org.requiredApprovals,
  }));
}

export async function addMember(orgId: string, userId: string, role: OrgRole) {
  const member = await prisma.orgMembership.upsert({
    where: { orgId_userId: { orgId, userId } },
    update: { role },
    create: { orgId, userId, role },
  });
  return member;
}

export async function resolveUserByHandle(handle: string): Promise<string | null> {
  const h = handle.trim();
  const byWallet = /^0x[a-fA-F0-9]{40}$/.test(h)
    ? await prisma.user.findUnique({ where: { walletAddress: h.toLowerCase() }, select: { id: true } })
    : null;
  if (byWallet) return byWallet.id;
  const byEmail = await prisma.user.findFirst({ where: { email: h }, select: { id: true } });
  if (byEmail) return byEmail.id;
  const byId = await prisma.user.findUnique({ where: { id: h }, select: { id: true } });
  return byId?.id ?? null;
}

export interface CreateApprovalInput {
  orgId: string;
  requestedById: string;
  action: ApprovableAction;
  payload: ApprovalPayload;
  amountUsd: number;
}

export async function createApprovalRequest(input: CreateApprovalInput) {
  const org = await prisma.organization.findUnique({ where: { id: input.orgId } });
  if (!org) throw new Error('Organization not found');
  const req = await prisma.approvalRequest.create({
    data: {
      orgId: input.orgId,
      requestedById: input.requestedById,
      action: input.action,
      payload: input.payload as never,
      amountUsd: input.amountUsd,
      requiredApprovals: org.requiredApprovals,
      status: 'PENDING',
    },
  });
  await logAudit({ orgId: input.orgId, userId: input.requestedById, actor: input.requestedById, action: 'APPROVAL_REQUESTED', detail: { id: req.id, action: input.action, amountUsd: input.amountUsd } });
  return req;
}

export async function decideApproval(
  orgId: string,
  approvalId: string,
  userId: string,
  decision: 'APPROVE' | 'REJECT',
) {
  const req = await prisma.approvalRequest.findFirst({ where: { id: approvalId, orgId } });
  if (!req) throw new Error('Approval request not found');
  if (req.status !== 'PENDING') throw new Error(`Approval already ${req.status.toLowerCase()}`);
  if (req.requestedById === userId) throw new Error('Requester cannot approve their own request (separation of duties)');

  await prisma.approvalDecision.upsert({
    where: { approvalId_userId: { approvalId, userId } },
    update: { decision },
    create: { approvalId, userId, decision },
  });

  if (decision === 'REJECT') {
    const updated = await prisma.approvalRequest.update({ where: { id: approvalId }, data: { status: 'REJECTED' } });
    await logAudit({ orgId, userId, actor: userId, action: 'APPROVAL_REJECTED', detail: { id: approvalId } });
    return updated;
  }

  const approvals = await prisma.approvalDecision.count({ where: { approvalId, decision: 'APPROVE' } });
  let status: 'PENDING' | 'APPROVED' = 'PENDING';
  if (approvals >= req.requiredApprovals) status = 'APPROVED';
  const updated = await prisma.approvalRequest.update({ where: { id: approvalId }, data: { status } });
  await logAudit({ orgId, userId, actor: userId, action: 'APPROVAL_APPROVED', detail: { id: approvalId, approvals, required: req.requiredApprovals, status } });
  return updated;
}

function actionToGuardian(action: string): GuardianAction {
  switch (action) {
    case 'WITHDRAW': return 'WITHDRAW';
    case 'SWAP': return 'SWAP';
    case 'EARN_DEPOSIT': return 'TRANSFER';
    case 'GATEWAY_SPEND': return 'GATEWAY_SPEND';
    default: return 'TRANSFER';
  }
}

export async function executeApproval(orgId: string, approvalId: string, executorUserId: string) {
  const req = await prisma.approvalRequest.findFirst({ where: { id: approvalId, orgId } });
  if (!req) throw new Error('Approval request not found');
  if (req.status !== 'APPROVED') throw new Error(`Approval is ${req.status.toLowerCase()}, not approved`);

  const wallet = await prisma.agentWallet.findUnique({ where: { userId: req.requestedById }, select: { circleWalletId: true, isActive: true } });
  if (!wallet?.circleWalletId) throw new Error('Requester has no agent wallet');
  if (!wallet.isActive) throw new Error('Requester agent wallet disabled');

  const action = req.action as ApprovableAction;
  const payload = req.payload as unknown as ApprovalPayload;

  const guardReq = { action: actionToGuardian(action), amountUsd: req.amountUsd } as Parameters<typeof evaluateAction>[1];
  if (action === 'WITHDRAW') {
    const p = payload as WithdrawPayload;
    guardReq.token = p.token;
    guardReq.destination = p.toAddress;
  } else if (action === 'SWAP') {
    const p = payload as SwapPayload;
    guardReq.token = p.fromToken;
  } else if (action === 'EARN_DEPOSIT') {
    guardReq.token = 'USDC';
  } else if (action === 'GATEWAY_SPEND') {
    const p = payload as GatewaySpendPayload;
    guardReq.token = 'USDC';
    guardReq.destination = p.recipient;
  }

  const guard = await evaluateAction(req.requestedById, guardReq);
  if (guard.result.decision === 'DENY') {
    await logAudit({ orgId, userId: executorUserId, actor: executorUserId, action: 'APPROVAL_BLOCKED', detail: { id: approvalId, reasons: guard.result.reasons } });
    throw new Error(`Guardian policy blocked execution: ${guard.result.reasons.join('; ')}`);
  }

  let result: { txHash: string };
  if (action === 'WITHDRAW') {
    const p = payload as WithdrawPayload;
    const r = await withdrawFromAgentWallet(wallet.circleWalletId, p.token, parseFloat(p.amount), p.toAddress);
    result = { txHash: r.txHash };
  } else if (action === 'SWAP') {
    const p = payload as SwapPayload;
    const r = await executeFxSwap(wallet.circleWalletId, p.fromToken, p.toToken, p.amount);
    result = { txHash: r.txHash };
  } else if (action === 'EARN_DEPOSIT') {
    const p = payload as EarnDepositPayload;
    const r = await earnDeposit(wallet.circleWalletId, p.amount);
    result = { txHash: r.txHash };
  } else if (action === 'GATEWAY_SPEND') {
    const p = payload as GatewaySpendPayload;
    const r = await gatewaySpend(wallet.circleWalletId, p.toChain, p.recipient, p.amount);
    result = { txHash: r.txHash };
  } else {
    throw new Error(`Unknown approval action: ${action}`);
  }

  const updated = await prisma.approvalRequest.update({
    where: { id: approvalId },
    data: { status: 'EXECUTED', executedTxHash: result.txHash },
  });
  await logAudit({ orgId, userId: executorUserId, actor: executorUserId, action: 'APPROVAL_EXECUTED', detail: { id: approvalId, action, txHash: result.txHash } });
  return { request: updated, result };
}
