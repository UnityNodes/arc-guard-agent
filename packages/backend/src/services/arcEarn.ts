import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { EarnKit, EarnChain } from '@circle-fin/earn-kit';
import type { EarnVaultInfo, EarnDepositQuoteInfo, EarnWithdrawalQuoteInfo } from '@circle-fin/earn-kit';
import { getCircleWalletsAdapter } from './circleAdapter';
import { logger } from '../lib/logger';

const CIRCLE_API_KEY       = process.env.CIRCLE_API_KEY || '';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';
const ARC_EARN_VAULT       = process.env.ARC_EARN_VAULT || '0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88';

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

function from(address: string) {
  return { adapter: getCircleWalletsAdapter() as never, chain: EarnChain.Arc_Testnet, address };
}

export interface EarnRewardMeta { token: string; tokenAddress: string; apy: number }
export interface EarnProtocolWarning { type: string; level: string }

export interface EarnInfo {
  vaultAddress: string;
  name: string;
  protocol: string;
  asset: string;
  assetAddress: string;
  apy: number;
  nativeApy: number;
  vaultFee: number;
  status: string;
  totalDeposits: string;
  liquidity: string;
  rewards: EarnRewardMeta[];
  protocolWarnings: EarnProtocolWarning[];
  earnKitWarnings: string[];
}

export async function getEarnInfo(): Promise<EarnInfo | null> {
  const kit = new EarnKit();
  const r = await kit.getVaults({ vaults: [{ chain: EarnChain.Arc_Testnet, vaultAddress: ARC_EARN_VAULT }] });
  const v = r.vaults?.[0] as EarnVaultInfo | undefined;
  if (!v) return null;
  return {
    vaultAddress: v.vaultAddress,
    name: v.name,
    protocol: v.protocol,
    asset: v.asset,
    assetAddress: v.assetAddress,
    apy: v.currentApy,
    nativeApy: v.nativeApy,
    vaultFee: v.vaultFee,
    status: v.status,
    totalDeposits: fmtAmount(v.totalDeposits),
    liquidity: fmtAmount(v.liquidity),
    rewards: Array.isArray(v.rewards)
      ? v.rewards.map((x) => ({ token: x.token, tokenAddress: x.tokenAddress, apy: x.apy }))
      : [],
    protocolWarnings: Array.isArray(v.warnings)
      ? v.warnings.map((w) => ({ type: w.type, level: w.level }))
      : [],
    earnKitWarnings: Array.isArray(v.earnKitWarnings) ? [...v.earnKitWarnings] : [],
  };
}

export async function getEarnPosition(walletId: string) {
  const address = await resolveAddress(walletId);
  const kit = new EarnKit();
  return kit.getPosition({ from: from(address), vaultAddress: ARC_EARN_VAULT });
}

export interface EarnTxResult {
  txHash: string;
  explorerUrl: string;
  vaultAddress: string;
  amount: string;
}

export async function earnDeposit(walletId: string, amount: string): Promise<EarnTxResult> {
  const address = await resolveAddress(walletId);
  const kit = new EarnKit();
  const r = await kit.deposit({ from: from(address), vaultAddress: ARC_EARN_VAULT, amount });
  logger.info('earn', `Earn deposit ${amount} USDC tx ${r.txHash}`);
  return { txHash: r.txHash, explorerUrl: r.explorerUrl, vaultAddress: r.vaultAddress, amount: r.amount };
}

export async function earnWithdraw(walletId: string, amount: string): Promise<EarnTxResult> {
  const address = await resolveAddress(walletId);
  const kit = new EarnKit();
  const r = await kit.withdraw({ from: from(address), vaultAddress: ARC_EARN_VAULT, amount });
  logger.info('earn', `Earn withdraw ${amount} USDC tx ${r.txHash}`);
  return { txHash: r.txHash, explorerUrl: r.explorerUrl, vaultAddress: r.vaultAddress, amount: r.amount };
}

export interface EarnQuoteFee { symbol: string; amount: string }

export interface EarnDepositQuote {
  vaultAddress: string;
  vaultName: string;
  deposit: string;
  expectedShares: string;
  sharePrice: string;
  currentApy: number;
  fees: EarnQuoteFee[];
}

export async function getEarnDepositQuote(walletId: string, amount: string): Promise<EarnDepositQuote> {
  const address = await resolveAddress(walletId);
  const kit = new EarnKit();
  const q = (await kit.getDepositQuote({ from: from(address), vaultAddress: ARC_EARN_VAULT, amount })) as EarnDepositQuoteInfo;
  return {
    vaultAddress: q.vaultAddress,
    vaultName: q.vaultName,
    deposit: fmtAmount(q.deposit?.amount),
    expectedShares: fmtAmount(q.expectedShares?.amount),
    sharePrice: q.sharePrice,
    currentApy: typeof q.currentApy === 'number' ? q.currentApy : 0,
    fees: Array.isArray(q.fees) ? q.fees.map((f) => ({ symbol: f.symbol, amount: fmtAmount(f.amount) })) : [],
  };
}

export interface EarnWithdrawalQuote {
  vaultAddress: string;
  vaultName: string;
  withdrawal: string;
  sharesToRedeem: string;
  sharePrice: string;
  maxWithdrawable: string;
  fees: EarnQuoteFee[];
  warnings: string[];
}

export async function getEarnWithdrawalQuote(walletId: string, amount: string): Promise<EarnWithdrawalQuote> {
  const address = await resolveAddress(walletId);
  const kit = new EarnKit();
  const q = (await kit.getWithdrawalQuote({ from: from(address), vaultAddress: ARC_EARN_VAULT, amount })) as EarnWithdrawalQuoteInfo;
  return {
    vaultAddress: q.vaultAddress,
    vaultName: q.vaultName,
    withdrawal: fmtAmount(q.withdrawal?.amount),
    sharesToRedeem: fmtAmount(q.sharesToRedeem?.amount),
    sharePrice: q.sharePrice,
    maxWithdrawable: fmtAmount(q.maxWithdrawable?.amount),
    fees: Array.isArray(q.fees) ? q.fees.map((f) => ({ symbol: f.symbol, amount: fmtAmount(f.amount) })) : [],
    warnings: Array.isArray(q.earnKitWarnings) ? [...q.earnKitWarnings] : [],
  };
}

function fmtAmount(a: unknown): string {
  if (a == null) return '0';
  const o = a as { formatted?: unknown; toString?: () => string; raw?: unknown; decimals?: unknown };
  if (typeof o.formatted === 'string') return o.formatted;
  if (typeof o.formatted === 'function') return (o.formatted as () => string)();
  if (typeof o.toString === 'function') {
    const s = o.toString();
    if (s && s !== '[object Object]') return s;
  }
  if (o.raw != null && o.decimals != null) {
    try {
      const raw = BigInt(String(o.raw));
      const dec = Number(o.decimals);
      const base = 10n ** BigInt(dec);
      const whole = raw / base;
      const frac = (raw % base).toString().padStart(dec, '0').replace(/0+$/, '');
      return frac ? `${whole}.${frac}` : whole.toString();
    } catch { return '0'; }
  }
  return '0';
}

export interface NormalizedReward { symbol: string; tokenAddress?: string; amount: string }

export interface NormalizedEarnPosition {
  vaultAddress: string;
  vaultName: string;
  asset: string;
  currentBalance: string;
  currentApy: number;
  shares: string;
  pnl: { status: string; principalDeposited?: string; totalYieldEarned?: string; reason?: string };
  accruedRewards: NormalizedReward[];
  rewardsUnavailableReason?: string;
}

export async function getEarnPositionNormalized(walletId: string): Promise<NormalizedEarnPosition> {
  const p = (await getEarnPosition(walletId)) as Record<string, any>;
  const pnlRaw = p?.pnl ?? {};
  const pnl: NormalizedEarnPosition['pnl'] = { status: pnlRaw.status ?? 'unavailable' };
  if (pnlRaw.status === 'available') {
    pnl.principalDeposited = fmtAmount(pnlRaw.principalDeposited);
    pnl.totalYieldEarned = fmtAmount(pnlRaw.totalYieldEarned);
  } else if (pnlRaw.status === 'unavailable' && pnlRaw.reason) {
    pnl.reason = pnlRaw.reason;
  }
  return {
    vaultAddress: p?.vaultAddress ?? ARC_EARN_VAULT,
    vaultName: p?.vaultName ?? '',
    asset: p?.asset ?? 'USDC',
    currentBalance: fmtAmount(p?.currentBalance),
    currentApy: typeof p?.currentApy === 'number' ? p.currentApy : 0,
    shares: fmtAmount(p?.shares),
    pnl,
    accruedRewards: Array.isArray(p?.accruedRewards)
      ? p.accruedRewards.map((r: Record<string, unknown>) => ({ symbol: String(r.symbol ?? ''), tokenAddress: r.tokenAddress as string | undefined, amount: fmtAmount(r.amount) }))
      : [],
    rewardsUnavailableReason: p?.rewardsUnavailableReason,
  };
}

export interface EarnClaimQuote { rewards: NormalizedReward[] }

export async function getEarnClaimQuote(walletId: string): Promise<EarnClaimQuote> {
  const address = await resolveAddress(walletId);
  const kit = new EarnKit();
  const q = (await kit.getClaimRewardsQuote({ from: from(address), vaultAddress: ARC_EARN_VAULT })) as Record<string, any>;
  return {
    rewards: Array.isArray(q?.rewards)
      ? q.rewards.map((r: Record<string, unknown>) => ({ symbol: String(r.symbol ?? ''), tokenAddress: (r.address ?? r.tokenAddress) as string | undefined, amount: fmtAmount(r.amount) }))
      : [],
  };
}

export interface EarnClaimResult {
  status: string;
  txHash?: string;
  explorerUrl?: string;
  rewards: NormalizedReward[];
}

export async function claimEarnRewards(walletId: string): Promise<EarnClaimResult> {
  const address = await resolveAddress(walletId);
  const kit = new EarnKit();
  const r = (await kit.claimRewards({ from: from(address), vaultAddress: ARC_EARN_VAULT })) as Record<string, any>;
  const rewards: NormalizedReward[] = Array.isArray(r?.rewards)
    ? r.rewards.map((x: Record<string, unknown>) => ({ symbol: String(x.symbol ?? ''), tokenAddress: (x.address ?? x.tokenAddress) as string | undefined, amount: fmtAmount(x.amount) }))
    : [];
  if (r?.status === 'claimed') {
    logger.info('earn', `Claimed ${rewards.length} reward token(s) tx ${r.txHash}`);
  }
  return { status: r?.status ?? 'no_rewards', txHash: r?.txHash, explorerUrl: r?.explorerUrl, rewards };
}
