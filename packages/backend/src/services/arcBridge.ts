import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { BridgeKit, ArcTestnet, EthereumSepolia, BaseSepolia, TransferSpeed, isRetryableError } from '@circle-fin/bridge-kit';
import type { ChainDefinition, BridgeResult as KitBridgeResult } from '@circle-fin/bridge-kit';
import { getCircleWalletsAdapter } from './circleAdapter';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { valueFeeForAmount } from './customFee';

const CIRCLE_API_KEY       = process.env.CIRCLE_API_KEY || '';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';

const CHAIN_MAP: Record<string, ChainDefinition> = {
  'arc-testnet':      ArcTestnet,
  'ethereum-sepolia': EthereumSepolia,
  'base-sepolia':     BaseSepolia,
};

function getAdapter() {
  return getCircleWalletsAdapter();
}

function getClient() {
  return initiateDeveloperControlledWalletsClient({
    apiKey: CIRCLE_API_KEY,
    entitySecret: CIRCLE_ENTITY_SECRET,
  });
}

export function getSupportedChains(): string[] {
  return Object.keys(CHAIN_MAP);
}

let kitSupportedChainIds: Set<number> | null = null;
function kitSupportedEvmTestnetChainIds(): Set<number> {
  if (kitSupportedChainIds) return kitSupportedChainIds;
  try {
    const chains = new BridgeKit().getSupportedChains({ chainType: 'evm', isTestnet: true });
    kitSupportedChainIds = new Set(
      chains
        .map((c) => (c as { chainId?: number }).chainId)
        .filter((id): id is number => typeof id === 'number'),
    );
  } catch (err) {
    logger.warn('bridge', `getSupportedChains lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    kitSupportedChainIds = new Set();
  }
  return kitSupportedChainIds;
}

export interface SupportedChain {
  id: string;
  name: string;
  chainId: number | null;
  isTestnet: boolean;
  explorerUrl: string | null;
  bridgeSupported: boolean;
  forwarderSourceSupported: boolean;
  forwarderDestinationSupported: boolean;
}

export function getSupportedChainDetails(): SupportedChain[] {
  const supported = kitSupportedEvmTestnetChainIds();
  return Object.entries(CHAIN_MAP).map(([id, def]) => {
    const chainId = (def as { chainId?: number }).chainId ?? null;
    const fwd = (def as { forwarderSupported?: { source?: boolean; destination?: boolean } }).forwarderSupported ?? {};
    return {
      id,
      name: def.name,
      chainId,
      isTestnet: def.isTestnet,
      explorerUrl: (def as { explorerUrl?: string }).explorerUrl ?? null,
      bridgeSupported: chainId != null && (supported.size === 0 || supported.has(chainId)),
      forwarderSourceSupported: fwd.source === true,
      forwarderDestinationSupported: fwd.destination === true,
    };
  });
}

export interface RouteCheck {
  supported: boolean;
  reason?: string;
}

export function supportsRoute(fromChain: string, toChain: string): RouteCheck {
  const src = CHAIN_MAP[fromChain];
  const dst = CHAIN_MAP[toChain];
  if (!src) return { supported: false, reason: `Unsupported source chain: ${fromChain}` };
  if (!dst) return { supported: false, reason: `Unsupported destination chain: ${toChain}` };
  if (fromChain === toChain) return { supported: false, reason: 'Source and destination chains must differ' };
  if (fromChain !== 'arc-testnet') return { supported: false, reason: 'Agent wallet lives on Arc; bridging is only supported from arc-testnet' };
  const supported = kitSupportedEvmTestnetChainIds();
  if (supported.size > 0) {
    const srcId = (src as { chainId?: number }).chainId;
    const dstId = (dst as { chainId?: number }).chainId;
    if (srcId != null && !supported.has(srcId)) return { supported: false, reason: `Bridge Kit does not support source chain ${fromChain}` };
    if (dstId != null && !supported.has(dstId)) return { supported: false, reason: `Bridge Kit does not support destination chain ${toChain}` };
  }
  return { supported: true };
}

export interface BridgeGasFee {
  name: string;
  token: string;
  chain: string;
  fee: string | null;
  error?: string;
}

export interface BridgeProtocolFee {
  type: string;
  token: string;
  amount: string | null;
  error?: string;
}

export interface BridgeQuote {
  fromChain: string;
  toChain: string;
  amount: string;
  token: string;
  transferSpeed: 'FAST' | 'SLOW';
  gasFees: BridgeGasFee[];
  protocolFees: BridgeProtocolFee[];
  totalProtocolFeeUsdc: string | null;
  forwarder: {
    enabled: boolean;
    destinationSupported: boolean;
    feeUsdc: string | null;
    note: string;
  };
}

function errMessage(e: unknown): string | undefined {
  if (e == null) return undefined;
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  const m = (e as { message?: unknown }).message;
  return typeof m === 'string' ? m : JSON.stringify(e);
}

export async function getBridgeQuote(
  walletId: string,
  fromChain: string,
  toChain: string,
  amount: string,
  transferSpeed: 'FAST' | 'SLOW' = 'FAST',
): Promise<BridgeQuote> {
  const route = supportsRoute(fromChain, toChain);
  if (!route.supported) throw new Error(route.reason ?? 'Unsupported bridge route');
  const src = CHAIN_MAP[fromChain];
  const dst = CHAIN_MAP[toChain];

  const fromAddress = await resolveAddress(walletId);
  const adapter = getAdapter();
  const kit = new BridgeKit();
  const speed = transferSpeed === 'SLOW' ? TransferSpeed.SLOW : TransferSpeed.FAST;

  const customFee = valueFeeForAmount(amount);
  const est = await kit.estimate({
    from: { adapter, chain: src, address: fromAddress },
    to: { chain: dst, recipientAddress: fromAddress, useForwarder: true },
    amount,
    token: 'USDC',
    config: customFee ? { transferSpeed: speed, customFee } : { transferSpeed: speed },
  });

  const gasFees: BridgeGasFee[] = (est.gasFees ?? []).map((g) => ({
    name: g.name,
    token: g.token,
    chain: String(g.blockchain),
    fee: g.fees?.fee ?? null,
    error: errMessage(g.error),
  }));

  const protocolFees: BridgeProtocolFee[] = (est.fees ?? []).map((f) => ({
    type: f.type,
    token: f.token,
    amount: f.amount,
    error: errMessage(f.error),
  }));

  let total = 0;
  let sawUsdc = false;
  let forwarderFee: string | null = null;
  for (const f of protocolFees) {
    if (f.token === 'USDC' && f.amount != null) {
      const v = Number(f.amount);
      if (isFinite(v)) { total += v; sawUsdc = true; }
    }
    if (f.type === 'forwarder' && f.amount != null) {
      forwarderFee = f.amount;
    }
  }

  const dstFwdSupported = (dst as { forwarderSupported?: { destination?: boolean } }).forwarderSupported?.destination === true;
  return {
    fromChain,
    toChain,
    amount,
    token: 'USDC',
    transferSpeed,
    gasFees,
    protocolFees,
    totalProtocolFeeUsdc: sawUsdc ? String(total) : null,
    forwarder: {
      enabled: true,
      destinationSupported: dstFwdSupported,
      feeUsdc: forwarderFee,
      note: dstFwdSupported
        ? 'Forwarding Service auto-mints on destination - recipient does not need gas there.'
        : 'Destination chain does not advertise forwarder support; mint may require recipient gas.',
    },
  };
}

export interface BridgeResult {
  id: string;
  txHash: string;
  fromChain: string;
  toChain: string;
  amount: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
}

function stepHash(result: KitBridgeResult, match: RegExp): string | undefined {
  return result.steps.find((s) => match.test(s.name) && s.txHash)?.txHash;
}

function stepSummary(result: KitBridgeResult) {
  return (result.steps ?? []).map((s) => ({
    name: s.name,
    state: (s as { state?: string }).state,
    txHash: s.txHash ?? null,
    explorerUrl: (s as { explorerUrl?: string }).explorerUrl ?? null,
    errorCategory: (s as { errorCategory?: string }).errorCategory ?? null,
    error: (s as { errorMessage?: string }).errorMessage
        ?? (s as { error?: { message?: string } }).error?.message
        ?? null,
  }));
}

function topError(result: KitBridgeResult): string | null {
  return (result as { error?: { message?: string } }).error?.message
      ?? (result as { errorMessage?: string }).errorMessage
      ?? null;
}

async function resolveAddress(walletId: string): Promise<string> {
  const r = await getClient().getWallet({ id: walletId });
  const address = r.data?.wallet?.address;
  if (!address) throw new Error('Cannot resolve agent wallet address');
  return address;
}

export interface BridgeProgressEvent {
  at: string;
  action: string;
  state: string | null;
  name: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  errorMessage: string | null;
  errorCategory: string | null;
}

const PROGRESS_KEY = (id: string) => `bridge:progress:${id}`;
const PROGRESS_TTL_SEC = 24 * 60 * 60;
const PROGRESS_MAX_EVENTS = 50;

function readProp(obj: unknown, key: string): unknown {
  if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[key];
  return undefined;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function normalizeKitEvent(action: string, payload: unknown): BridgeProgressEvent {
  const values = readProp(payload, 'values');
  const errorObj = readProp(payload, 'error');
  return {
    at: new Date().toISOString(),
    action,
    state: stringOrNull(readProp(payload, 'state'))
        ?? stringOrNull(readProp(values, 'state')),
    name: stringOrNull(readProp(payload, 'name'))
       ?? stringOrNull(readProp(values, 'name')),
    txHash: stringOrNull(readProp(payload, 'txHash'))
         ?? stringOrNull(readProp(values, 'txHash')),
    explorerUrl: stringOrNull(readProp(payload, 'explorerUrl'))
              ?? stringOrNull(readProp(values, 'explorerUrl')),
    errorMessage: stringOrNull(readProp(payload, 'errorMessage'))
               ?? stringOrNull(readProp(errorObj, 'message')),
    errorCategory: stringOrNull(readProp(payload, 'errorCategory')),
  };
}

async function recordBridgeEvent(bridgeId: string, ev: BridgeProgressEvent): Promise<void> {
  try {
    await redis
      .multi()
      .lpush(PROGRESS_KEY(bridgeId), JSON.stringify(ev))
      .ltrim(PROGRESS_KEY(bridgeId), 0, PROGRESS_MAX_EVENTS - 1)
      .expire(PROGRESS_KEY(bridgeId), PROGRESS_TTL_SEC)
      .exec();
  } catch (err) {
    logger.warn('bridge', `progress event write failed for ${bridgeId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getBridgeProgress(bridgeId: string): Promise<BridgeProgressEvent[]> {
  try {
    const raw = await redis.lrange(PROGRESS_KEY(bridgeId), 0, PROGRESS_MAX_EVENTS - 1);
    const events: BridgeProgressEvent[] = [];
    for (let i = raw.length - 1; i >= 0; i--) {
      try { events.push(JSON.parse(raw[i]) as BridgeProgressEvent); } catch { /* skip */ }
    }
    return events;
  } catch (err) {
    logger.warn('bridge', `progress event read failed for ${bridgeId}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

async function persistResult(recordId: string, result: KitBridgeResult): Promise<void> {
  const burn = stepHash(result, /burn/i);
  const mint = stepHash(result, /mint/i);
  const status = result.state === 'success' ? 'SUCCESS' : result.state === 'error' ? 'FAILED' : 'PENDING';
  const error = result.state === 'error'
    ? (topError(result) ?? `bridge state=error: ${JSON.stringify(stepSummary(result))}`)
    : null;
  await prisma.bridgeTransaction.update({
    where: { id: recordId },
    data: {
      status,
      txHash: burn ?? null,
      destinationTxHash: mint ?? null,
      error,
      resultJson: JSON.stringify(result),
    },
  });
}

export async function executeBridge(
  walletId: string,
  userId: string,
  fromChain: string,
  toChain: string,
  amount: string,
  destinationAddress: string,
  transferSpeed: 'FAST' | 'SLOW' = 'FAST',
): Promise<BridgeResult> {
  const route = supportsRoute(fromChain, toChain);
  if (!route.supported) throw new Error(route.reason ?? 'Unsupported bridge route');
  if (!/^0x[a-fA-F0-9]{40}$/.test(destinationAddress)) throw new Error('Invalid destination address');
  const src = CHAIN_MAP[fromChain];
  const dst = CHAIN_MAP[toChain];

  const fromAddress = await resolveAddress(walletId);

  const record = await prisma.bridgeTransaction.create({
    data: {
      userId,
      fromChain,
      toChain,
      fromToken: 'USDC',
      toToken: 'USDC',
      amount,
      status: 'PENDING',
    },
  });

  const adapter = getAdapter();
  const kit = new BridgeKit();
  const speed = transferSpeed === 'SLOW' ? TransferSpeed.SLOW : TransferSpeed.FAST;

  const onAny = (payload: unknown) => {
    const action = stringOrNull(readProp(payload, 'method'))
                ?? stringOrNull(readProp(payload, 'action'))
                ?? stringOrNull(readProp(payload, 'name'))
                ?? 'event';
    void recordBridgeEvent(record.id, normalizeKitEvent(action, payload));
    // Update bridge status in DB as CCTP steps progress, so the dashboard banner advances
    const step = action.toLowerCase();
    let intermediateStatus: string | null = null;
    if (/burn/.test(step)) intermediateStatus = 'SUBMITTED';
    else if (/attest/.test(step)) intermediateStatus = 'ATTESTING';
    else if (/mint/.test(step)) intermediateStatus = 'MINTING';
    if (intermediateStatus) {
      prisma.bridgeTransaction.update({ where: { id: record.id }, data: { status: intermediateStatus } })
        .catch(() => {});
    }
  };
  (kit as unknown as { on: (a: '*', h: (p: unknown) => void) => void }).on('*', onAny);

  await recordBridgeEvent(record.id, {
    at: new Date().toISOString(),
    action: 'submitted',
    state: 'started',
    name: 'submit',
    txHash: null,
    explorerUrl: null,
    errorMessage: null,
    errorCategory: null,
  });

  const execFee = valueFeeForAmount(amount);
  kit
    .bridge({
      from: { adapter, chain: src, address: fromAddress },
      to: { chain: dst, recipientAddress: destinationAddress, useForwarder: true },
      amount,
      config: execFee ? { transferSpeed: speed, customFee: execFee } : { transferSpeed: speed },
    })
    .then(async (result) => {
      await persistResult(record.id, result);
      const burn = stepHash(result, /burn/i);
      const mint = stepHash(result, /mint/i);
      logger.info('bridge', `Bridge ${record.id} ${fromChain}->${toChain} ${amount} USDC state=${result.state} burn=${burn ?? '-'} mint=${mint ?? '-'}`);
      if (result.state === 'error') {
        logger.error('bridge', `Bridge ${record.id} state=error topError=${topError(result) ?? 'none'} steps=${JSON.stringify(stepSummary(result))}`);
      }
      await recordBridgeEvent(record.id, {
        at: new Date().toISOString(),
        action: 'completed',
        state: result.state === 'success' ? 'success' : result.state === 'error' ? 'error' : 'pending',
        name: 'final',
        txHash: mint ?? burn ?? null,
        explorerUrl: null,
        errorMessage: result.state === 'error' ? topError(result) : null,
        errorCategory: null,
      });
    })
    .catch(async (err) => {
      const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
      await prisma.bridgeTransaction
        .update({ where: { id: record.id }, data: { status: 'FAILED', error: err instanceof Error ? err.message : String(err) } })
        .catch(() => {});
      logger.error('bridge', `Bridge ${record.id} failed: ${msg}`);
      await recordBridgeEvent(record.id, {
        at: new Date().toISOString(),
        action: 'completed',
        state: 'error',
        name: 'final',
        txHash: null,
        explorerUrl: null,
        errorMessage: err instanceof Error ? err.message : String(err),
        errorCategory: null,
      });
    })
    .finally(() => {
      try {
        (kit as unknown as { off: (a: '*', h: (p: unknown) => void) => void }).off('*', onAny);
      } catch { /* off is best-effort */ }
    });

  logger.info('bridge', `Bridge ${record.id} submitted ${amount} USDC ${fromChain}->${toChain} via forwarder`);
  // Invalidate dashboard transactions cache so the bridge appears immediately
  // in Recent Activity regardless of whether the caller was the HTTP route or Aegis.
  redis.del(`agent:history:${fromAddress}`).catch(() => {});
  return { id: record.id, txHash: '', fromChain, toChain, amount: `${amount} USDC`, status: 'PENDING' };
}

const RECONCILE_GRACE_MS = 5 * 60_000;
const RETRY_COOLDOWN_MS = 5 * 60_000;
const RECONCILE_MAX_AGE_MS = 24 * 60 * 60_000;

// Mark bridges stuck in intermediate states (MINTING/ATTESTING/SUBMITTED/PROCESSING)
// as FAILED if they're older than 30 minutes - these are orphaned by restarts.
export async function cleanupOrphanedBridges(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  const updated = await prisma.bridgeTransaction.updateMany({
    where: {
      status: { in: ['MINTING', 'ATTESTING', 'SUBMITTED', 'PROCESSING'] },
      createdAt: { lt: cutoff },
    },
    data: { status: 'FAILED', error: 'Bridge timed out: process restarted or network error' },
  });
  if (updated.count > 0) {
    logger.warn('bridge', `cleanupOrphanedBridges: marked ${updated.count} stuck bridges as FAILED`);
  }
}

export async function reconcileStuckBridges(): Promise<void> {
  await cleanupOrphanedBridges();
  const now = Date.now();
  const stuck = await prisma.bridgeTransaction.findMany({
    where: {
      status: { in: ['PENDING', 'FAILED'] },
      destinationTxHash: null,
      txHash: { not: null },
      resultJson: { not: null },
      createdAt: { gt: new Date(now - RECONCILE_MAX_AGE_MS), lt: new Date(now - RECONCILE_GRACE_MS) },
    },
    orderBy: { createdAt: 'asc' },
    take: 10,
  });

  if (stuck.length === 0) return;

  const adapter = getAdapter();

  for (const row of stuck) {
    if (row.lastRetryAt && now - row.lastRetryAt.getTime() < RETRY_COOLDOWN_MS) continue;
    let parsed: KitBridgeResult;
    try {
      parsed = JSON.parse(row.resultJson!) as KitBridgeResult;
    } catch {
      continue;
    }
    if (!parsed.provider || !Array.isArray(parsed.steps)) continue;

    const erroredSteps = (parsed.steps ?? []).filter((s) => (s as { state?: string }).state === 'error');
    const fatalStep = erroredSteps.find((s) => {
      const e = (s as { error?: unknown }).error;
      return e !== undefined && !isRetryableError(e);
    });
    if (fatalStep) {
      const msg = (fatalStep as { errorMessage?: string }).errorMessage
        ?? errMessage((fatalStep as { error?: unknown }).error)
        ?? 'non-retryable bridge error';
      logger.warn('bridge', `Reconcile ${row.id} skipped: non-retryable error on step ${(fatalStep as { name?: string }).name ?? '?'}: ${msg}`);
      await prisma.bridgeTransaction
        .update({ where: { id: row.id }, data: { status: 'FAILED', error: `Non-retryable: ${msg}`, lastRetryAt: new Date() } })
        .catch(() => {});
      continue;
    }

    await prisma.bridgeTransaction.update({ where: { id: row.id }, data: { lastRetryAt: new Date() } }).catch(() => {});

    try {
      const kit = new BridgeKit();
      logger.info('bridge', `Reconciling stuck bridge ${row.id} (burn=${row.txHash}, mint missing) via retry`);
      const result = await kit.retry(parsed, { from: adapter });
      await persistResult(row.id, result);
      const mint = stepHash(result, /mint/i);
      logger.info('bridge', `Reconcile ${row.id} state=${result.state} mint=${mint ?? '-'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('bridge', `Reconcile ${row.id} retry failed: ${msg}`);
      await prisma.bridgeTransaction
        .update({ where: { id: row.id }, data: { error: msg } })
        .catch(() => {});
    }
  }
}
