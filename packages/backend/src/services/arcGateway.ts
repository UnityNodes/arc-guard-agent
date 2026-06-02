import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { UnifiedBalanceKit, UnifiedBalanceChain } from '@circle-fin/unified-balance-kit';
import type { SupportedTokenInput } from '@circle-fin/unified-balance-kit';
import { createPublicClient, http } from 'viem';
import { getCircleWalletsAdapter } from './circleAdapter';
import { logger } from '../lib/logger';

const CIRCLE_API_KEY       = process.env.CIRCLE_API_KEY || '';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';
const ARC_RPC_URL          = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network/';

const CHAIN_MAP: Record<string, UnifiedBalanceChain> = {
  'arc-testnet':      UnifiedBalanceChain.Arc_Testnet,
  'ethereum-sepolia': UnifiedBalanceChain.Ethereum_Sepolia,
  'base-sepolia':     UnifiedBalanceChain.Base_Sepolia,
  'avalanche-fuji':   UnifiedBalanceChain.Avalanche_Fuji,
  'arbitrum-sepolia': UnifiedBalanceChain.Arbitrum_Sepolia,
  'optimism-sepolia': UnifiedBalanceChain.Optimism_Sepolia,
  'unichain-sepolia': UnifiedBalanceChain.Unichain_Sepolia,
  'polygon-amoy':     UnifiedBalanceChain.Polygon_Amoy_Testnet,
};

export function isGatewayConfigured(): boolean {
  return !!(CIRCLE_API_KEY && CIRCLE_ENTITY_SECRET);
}

export function getGatewayChains(): string[] {
  return Object.keys(CHAIN_MAP);
}

function getAdapter() {
  return getCircleWalletsAdapter();
}

function getClient() {
  return initiateDeveloperControlledWalletsClient({
    apiKey: CIRCLE_API_KEY,
    entitySecret: CIRCLE_ENTITY_SECRET,
  });
}

async function resolveAddress(walletId: string): Promise<string> {
  const r = await getClient().getWallet({ id: walletId });
  const address = r.data?.wallet?.address;
  if (!address) throw new Error('Cannot resolve agent wallet address');
  return address;
}

export interface GatewayBalance {
  token: string;
  total: string;
  totalPending: string;
  breakdown: { chain: string; balance: string; pending: string }[];
}

export async function getGatewayBalance(walletId: string, token: SupportedTokenInput = 'USDC'): Promise<GatewayBalance> {
  const address = await resolveAddress(walletId);
  const kit = new UnifiedBalanceKit();
  const r = await kit.getBalances({
    sources: { adapter: getAdapter(), address },
    token,
    networkType: 'testnet',
    includePending: true,
  });
  const breakdown: { chain: string; balance: string; pending: string }[] = [];
  for (const depositor of r.breakdown) {
    for (const c of depositor.breakdown) {
      breakdown.push({
        chain: String(c.chain),
        balance: c.confirmedBalance ?? '0',
        pending: (c as { pendingBalance?: string }).pendingBalance ?? '0',
      });
    }
  }
  return {
    token: r.token,
    total: r.totalConfirmedBalance,
    totalPending: r.totalPendingBalance ?? '0',
    breakdown,
  };
}

export interface GatewayMultiSourceBalance {
  token: string;
  totalConfirmed: string;
  totalPending: string;
  perDepositor: {
    depositor: string;
    totalConfirmed: string;
    totalPending: string;
    breakdown: { chain: string; balance: string; pending: string; pendingTxs?: { hash: string; amount: string; timestamp: string }[] }[];
  }[];
}

export async function getMultiSourceGatewayBalance(
  walletId: string,
  extraSources: { address: string; chains?: string[] }[] = [],
  token: SupportedTokenInput = 'USDC',
  includePending = true,
): Promise<GatewayMultiSourceBalance> {
  const agentAddress = await resolveAddress(walletId);
  const kit = new UnifiedBalanceKit();
  const sources: ({ adapter: ReturnType<typeof getAdapter>; address: string } | { address: string; chains?: UnifiedBalanceChain | UnifiedBalanceChain[] })[] = [
    { adapter: getAdapter(), address: agentAddress },
  ];
  for (const src of extraSources) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(src.address)) throw new Error(`Invalid extra source address ${src.address}`);
    const mappedChains = (src.chains ?? []).map((c) => {
      const m = CHAIN_MAP[c];
      if (!m) throw new Error(`Unsupported Gateway chain in source: ${c}`);
      return m;
    });
    sources.push(mappedChains.length === 0
      ? { address: src.address }
      : { address: src.address, chains: mappedChains.length === 1 ? mappedChains[0] : mappedChains });
  }
  const r = await kit.getBalances({
    sources: sources as never,
    token,
    networkType: 'testnet',
    includePending,
  });
  const perDepositor = r.breakdown.map((d) => ({
    depositor: d.depositor,
    totalConfirmed: d.totalConfirmed,
    totalPending: (d as { totalPending?: string }).totalPending ?? '0',
    breakdown: d.breakdown.map((c) => ({
      chain: String(c.chain),
      balance: c.confirmedBalance ?? '0',
      pending: (c as { pendingBalance?: string }).pendingBalance ?? '0',
      pendingTxs: (c as { pendingTransactions?: { transactionHash: string; amount: string; blockTimestamp: string }[] }).pendingTransactions?.map((t) => ({
        hash: t.transactionHash,
        amount: t.amount,
        timestamp: t.blockTimestamp,
      })),
    })),
  }));
  return {
    token: r.token,
    totalConfirmed: r.totalConfirmedBalance,
    totalPending: r.totalPendingBalance ?? '0',
    perDepositor,
  };
}

export interface SpendAllocation {
  amount: string;
  chain: string;
}

function mapAllocations(allocations: SpendAllocation[]): { amount: string; chain: UnifiedBalanceChain }[] {
  return allocations.map((a) => {
    const chain = CHAIN_MAP[a.chain];
    if (!chain) throw new Error(`Unsupported allocation chain: ${a.chain}`);
    if (!/^\d+(\.\d+)?$/.test(a.amount)) throw new Error(`Invalid allocation amount: ${a.amount}`);
    if (Number(a.amount) <= 0) throw new Error(`Allocation amount must be > 0 for ${a.chain}`);
    return { amount: a.amount, chain };
  });
}

export interface GatewayDepositResult {
  txHash: string;
  explorerUrl?: string;
  amount: string;
  token: string;
  depositedTo: string;
}

export async function gatewayDeposit(
  walletId: string,
  amount: string,
  token: SupportedTokenInput = 'USDC',
  fromChain = 'arc-testnet',
): Promise<GatewayDepositResult> {
  const chain = CHAIN_MAP[fromChain];
  if (!chain) throw new Error(`Unsupported Gateway chain: ${fromChain}`);
  const address = await resolveAddress(walletId);
  const kit = new UnifiedBalanceKit();
  const r = await kit.deposit({
    from: { adapter: getAdapter(), chain, address },
    amount,
    token,
  });
  logger.info('gateway', `Deposit ${amount} ${token} on ${fromChain} tx ${r.txHash}`);
  return {
    txHash: r.txHash,
    explorerUrl: r.explorerUrl,
    amount: r.amount,
    token: r.token,
    depositedTo: r.depositedTo,
  };
}

export interface GatewaySpendResult {
  txHash: string;
  explorerUrl?: string;
  destinationChain: string;
  recipientAddress: string;
}

export async function gatewaySpend(
  walletId: string,
  toChain: string,
  recipientAddress: string,
  amount: string,
  token: SupportedTokenInput = 'USDC',
  allocations?: SpendAllocation[],
): Promise<GatewaySpendResult> {
  const chain = CHAIN_MAP[toChain];
  if (!chain) throw new Error(`Unsupported Gateway chain: ${toChain}`);
  if (!/^0x[a-fA-F0-9]{40}$/.test(recipientAddress)) throw new Error('Invalid recipient address');
  const address = await resolveAddress(walletId);
  const kit = new UnifiedBalanceKit();
  const mappedAllocs = allocations && allocations.length > 0 ? mapAllocations(allocations) : null;
  if (mappedAllocs) {
    const sum = mappedAllocs.reduce((acc, a) => acc + Number(a.amount), 0);
    if (Math.abs(sum - Number(amount)) > 1e-9) {
      throw new Error(`Allocation total ${sum} does not match amount ${amount}`);
    }
  }
  const fromSrc = mappedAllocs
    ? { adapter: getAdapter(), address, allocations: mappedAllocs.length === 1 ? mappedAllocs[0] : mappedAllocs }
    : { adapter: getAdapter(), address };
  const r = await kit.spend({
    from: fromSrc as never,
    to: { chain, recipientAddress, useForwarder: true },
    amount,
    token,
  } as never);
  logger.info('gateway', `Spend ${amount} ${token} -> ${toChain} ${recipientAddress} allocs=${mappedAllocs ? mappedAllocs.map((a) => `${a.amount}@${String(a.chain)}`).join(',') : 'auto'} tx ${r.txHash}`);
  return {
    txHash: r.txHash,
    explorerUrl: r.explorerUrl,
    destinationChain: String(r.destinationChain),
    recipientAddress: r.recipientAddress,
  };
}

export interface GatewayFeeEntry {
  type: string;
  token: string;
  amount: string;
  allocations?: { chain: string; amount: string }[];
}

export interface GatewaySpendEstimate {
  fees: GatewayFeeEntry[];
  totalFee: string;
  token: string;
}

export async function estimateGatewaySpend(
  walletId: string,
  toChain: string,
  recipientAddress: string,
  amount: string,
  token: SupportedTokenInput = 'USDC',
  allocations?: SpendAllocation[],
): Promise<GatewaySpendEstimate> {
  const chain = CHAIN_MAP[toChain];
  if (!chain) throw new Error(`Unsupported Gateway chain: ${toChain}`);
  if (!/^0x[a-fA-F0-9]{40}$/.test(recipientAddress)) throw new Error('Invalid recipient address');
  const address = await resolveAddress(walletId);
  const kit = new UnifiedBalanceKit();
  const mappedAllocs = allocations && allocations.length > 0 ? mapAllocations(allocations) : null;
  const fromSrc = mappedAllocs
    ? { adapter: getAdapter(), address, allocations: mappedAllocs.length === 1 ? mappedAllocs[0] : mappedAllocs }
    : { adapter: getAdapter(), address };
  const r = await kit.estimateSpend({
    from: fromSrc as never,
    to: { chain, recipientAddress, useForwarder: true },
    amount,
    token,
  } as never);
  const fees: GatewayFeeEntry[] = Array.isArray(r.fees)
    ? r.fees.map((f) => ({
        type: String(f.type),
        token: f.token,
        amount: f.amount,
        allocations: Array.isArray(f.allocations)
          ? f.allocations.map((a) => ({ chain: String(a.chain), amount: a.amount }))
          : undefined,
      }))
    : [];
  let total = 0;
  for (const f of fees) {
    if (f.token === token) {
      const n = Number(f.amount);
      if (Number.isFinite(n)) total += n;
    }
  }
  return { fees, totalFee: total.toString(), token: String(token) };
}

export interface GatewayDelegateResult {
  account: string;
  delegateAddress: string;
  chain: string;
  state: 'added' | 'removed';
  txHash: string;
  explorerUrl?: string;
}

export async function gatewayAddDelegate(
  walletId: string,
  delegateAddress: string,
  chainKey = 'arc-testnet',
): Promise<GatewayDelegateResult> {
  const chain = CHAIN_MAP[chainKey];
  if (!chain) throw new Error(`Unsupported Gateway chain: ${chainKey}`);
  if (!/^0x[a-fA-F0-9]{40}$/.test(delegateAddress)) throw new Error('Invalid delegate address');
  const address = await resolveAddress(walletId);
  const kit = new UnifiedBalanceKit();
  const r = await kit.addDelegate({ from: { adapter: getAdapter(), chain, address }, delegateAddress, token: 'USDC' });
  logger.info('gateway', `Add delegate ${delegateAddress} on ${chainKey} tx ${r.txHash}`);
  return { account: r.account, delegateAddress: r.delegateAddress, chain: String(r.chain), state: r.state, txHash: r.txHash, explorerUrl: r.explorerUrl };
}

export async function gatewayRemoveDelegate(
  walletId: string,
  delegateAddress: string,
  chainKey = 'arc-testnet',
): Promise<GatewayDelegateResult> {
  const chain = CHAIN_MAP[chainKey];
  if (!chain) throw new Error(`Unsupported Gateway chain: ${chainKey}`);
  if (!/^0x[a-fA-F0-9]{40}$/.test(delegateAddress)) throw new Error('Invalid delegate address');
  const address = await resolveAddress(walletId);
  const kit = new UnifiedBalanceKit();
  const r = await kit.removeDelegate({ from: { adapter: getAdapter(), chain, address }, delegateAddress, token: 'USDC' });
  logger.info('gateway', `Remove delegate ${delegateAddress} on ${chainKey} tx ${r.txHash}`);
  return { account: r.account, delegateAddress: r.delegateAddress, chain: String(r.chain), state: r.state, txHash: r.txHash, explorerUrl: r.explorerUrl };
}

export interface GatewayDelegateStatus {
  status: 'none' | 'pending' | 'ready';
  delegateAddress: string;
  chain: string;
}

export async function getGatewayDelegateStatus(
  walletId: string,
  delegateAddress: string,
  chainKey = 'arc-testnet',
): Promise<GatewayDelegateStatus> {
  const chain = CHAIN_MAP[chainKey];
  if (!chain) throw new Error(`Unsupported Gateway chain: ${chainKey}`);
  if (!/^0x[a-fA-F0-9]{40}$/.test(delegateAddress)) throw new Error('Invalid delegate address');
  const address = await resolveAddress(walletId);
  const kit = new UnifiedBalanceKit();
  const status = await kit.getDelegateStatus({ from: { adapter: getAdapter(), chain, address }, delegateAddress, token: 'USDC' });
  return { status, delegateAddress, chain: chainKey };
}

export interface GatewayWithdrawInit {
  amount: string;
  token: string;
  account: string;
  chain: string;
  withdrawingBalance: string;
  withdrawalBlock: number;
  txHash: string;
  explorerUrl?: string;
}

export async function initiateGatewayWithdraw(
  walletId: string,
  amount: string,
  chainKey = 'arc-testnet',
): Promise<GatewayWithdrawInit> {
  const chain = CHAIN_MAP[chainKey];
  if (!chain) throw new Error(`Unsupported Gateway chain: ${chainKey}`);
  const address = await resolveAddress(walletId);
  const kit = new UnifiedBalanceKit();
  const r = await kit.initiateRemoveFund({ from: { adapter: getAdapter(), chain, address }, amount, token: 'USDC' });
  logger.info('gateway', `Initiate withdraw ${amount} USDC on ${chainKey}, completable at block ${r.withdrawalBlock} tx ${r.txHash}`);
  return {
    amount: r.amount,
    token: String(r.token),
    account: r.account,
    chain: String(r.chain),
    withdrawingBalance: r.withdrawingBalance,
    withdrawalBlock: r.withdrawalBlock,
    txHash: r.txHash,
    explorerUrl: r.explorerUrl,
  };
}

export interface GatewayWithdrawComplete {
  amount: string;
  token: string;
  account: string;
  chain: string;
  txHash: string;
  explorerUrl?: string;
}

export async function completeGatewayWithdraw(
  walletId: string,
  chainKey = 'arc-testnet',
): Promise<GatewayWithdrawComplete> {
  const chain = CHAIN_MAP[chainKey];
  if (!chain) throw new Error(`Unsupported Gateway chain: ${chainKey}`);
  const address = await resolveAddress(walletId);
  const kit = new UnifiedBalanceKit();
  const r = await kit.removeFund({ from: { adapter: getAdapter(), chain, address }, token: 'USDC' });
  logger.info('gateway', `Complete withdraw on ${chainKey} tx ${r.txHash}`);
  return { amount: r.amount, token: String(r.token), account: r.account, chain: String(r.chain), txHash: r.txHash, explorerUrl: r.explorerUrl };
}

export interface GatewayWithdrawStatus {
  chain: string;
  currentBlock: number | null;
  withdrawalBlock: number;
  blocksRemaining: number | null;
  ready: boolean | null;
  note?: string;
}

export async function getGatewayWithdrawalStatus(
  withdrawalBlock: number,
  chainKey = 'arc-testnet',
): Promise<GatewayWithdrawStatus> {
  if (chainKey !== 'arc-testnet') {
    return {
      chain: chainKey,
      currentBlock: null,
      withdrawalBlock,
      blocksRemaining: null,
      ready: null,
      note: 'Live block height is tracked only for arc-testnet; complete the withdrawal once the source chain reaches the withdrawal block.',
    };
  }
  const client = createPublicClient({ transport: http(ARC_RPC_URL) });
  const current = Number(await client.getBlockNumber());
  const blocksRemaining = Math.max(0, withdrawalBlock - current);
  return { chain: chainKey, currentBlock: current, withdrawalBlock, blocksRemaining, ready: current >= withdrawalBlock };
}

export interface GatewayDepositForResult extends GatewayDepositResult {
  depositAccount: string;
}

export async function gatewayDepositFor(
  walletId: string,
  amount: string,
  depositAccount: string,
  fromChain = 'arc-testnet',
  token: SupportedTokenInput = 'USDC',
): Promise<GatewayDepositForResult> {
  const chain = CHAIN_MAP[fromChain];
  if (!chain) throw new Error(`Unsupported Gateway chain: ${fromChain}`);
  if (!/^0x[a-fA-F0-9]{40}$/.test(depositAccount)) throw new Error('Invalid deposit account address');
  const address = await resolveAddress(walletId);
  const kit = new UnifiedBalanceKit();
  const r = await kit.depositFor({ from: { adapter: getAdapter(), chain, address }, amount, token, depositAccount });
  logger.info('gateway', `DepositFor ${amount} ${token} -> ${depositAccount} on ${fromChain} tx ${r.txHash}`);
  return {
    txHash: r.txHash,
    explorerUrl: r.explorerUrl,
    amount: r.amount,
    token: r.token,
    depositedTo: r.depositedTo,
    depositAccount,
  };
}

export interface GatewayChainDetail {
  chain: string;
  name: string;
  chainId: number | null;
  isTestnet: boolean;
  usdcAddress: string | null;
  gatewaySupported: boolean;
}

export function getGatewaySupportedChainDetails(token: SupportedTokenInput = 'USDC'): GatewayChainDetail[] {
  const kit = new UnifiedBalanceKit();
  const chains = kit.getSupportedChains(token);
  return chains.map((c) => ({
    chain: String(c.chain),
    name: c.name,
    chainId: (c as { chainId?: number }).chainId ?? null,
    isTestnet: c.isTestnet,
    usdcAddress: c.usdcAddress ?? null,
    gatewaySupported: !!(c as { gateway?: unknown }).gateway,
  }));
}
