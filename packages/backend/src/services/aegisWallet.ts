import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../lib/logger';
import { redis } from '../lib/redis';

const exec = promisify(execFile);

const STATUS_CACHE_KEY = 'aegis:status:v1';
const STATUS_CACHE_TTL = 300; // 5 min, login session lasts 7d, version/terms never change; kept warm by background re-warm
const WALLETS_CACHE_KEY = 'aegis:wallets:v1';
const WALLETS_CACHE_TTL = 60; // 60s, wallet balances refresh once a minute
const MARKETPLACE_CACHE_PREFIX = 'aegis:market:v1:';
const MARKETPLACE_CACHE_TTL = 300; // 5 min, marketplace listings rarely change

const CIRCLE_BIN = process.env.CIRCLE_CLI_BIN || 'circle';
const AEGIS_DEFAULT_CHAIN = (process.env.AEGIS_WALLET_CHAIN || 'BASE').toUpperCase();
const AEGIS_MAX_USDC_PER_CALL = process.env.AEGIS_MAX_USDC_PER_CALL || '0.10';

async function cli(args: string[], timeoutMs = 30_000): Promise<{ stdout: string; stderr: string }> {
  try {
    return await exec(CIRCLE_BIN, args, { timeout: timeoutMs, env: { ...process.env, CIRCLE_ACCEPT_TERMS: '0' } });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? 'unknown error' };
  }
}

async function cliJson<T = unknown>(args: string[], timeoutMs = 30_000): Promise<T | null> {
  const { stdout } = await cli([...args, '--output', 'json'], timeoutMs);
  if (!stdout.trim()) return null;
  try { return JSON.parse(stdout) as T; } catch { return null; }
}

export interface AegisStatus {
  cliInstalled: boolean;
  cliVersion: string | null;
  termsAccepted: boolean;
  loggedIn: boolean;
  email: string | null;
  sessionExpiresAt: string | null;
  defaultChain: string;
  maxPerCallUsdc: string;
  message: string;
}

export async function getAegisStatus(force = false): Promise<AegisStatus> {
  if (!force) {
    try {
      const cached = await redis.get(STATUS_CACHE_KEY);
      if (cached) return JSON.parse(cached) as AegisStatus;
    } catch { /* ignore */ }
  }

  const v = await cli(['--version'], 5_000);
  const cliInstalled = !!v.stdout.trim() && !v.stderr.includes('not found');
  const cliVersion = cliInstalled ? v.stdout.trim().split('\n')[0] : null;

  if (!cliInstalled) {
    return {
      cliInstalled: false,
      cliVersion: null,
      termsAccepted: false,
      loggedIn: false,
      email: null,
      sessionExpiresAt: null,
      defaultChain: AEGIS_DEFAULT_CHAIN,
      maxPerCallUsdc: AEGIS_MAX_USDC_PER_CALL,
      message: 'Circle CLI binary not found. Rebuild the backend container, it ships with @circle-fin/cli.',
    };
  }

  const termsShow = await cliJson<{ data?: { accepted?: boolean } }>(['terms', 'show']);
  const termsAccepted = termsShow?.data?.accepted === true;

  if (!termsAccepted) {
    return {
      cliInstalled: true,
      cliVersion,
      termsAccepted: false,
      loggedIn: false,
      email: null,
      sessionExpiresAt: null,
      defaultChain: AEGIS_DEFAULT_CHAIN,
      maxPerCallUsdc: AEGIS_MAX_USDC_PER_CALL,
      message: 'Circle CLI terms not yet accepted. Run the bootstrap flow in your terminal.',
    };
  }

  const status = await cli(['wallet', 'status', '--output', 'json'], 8_000);
  if (status.stderr.toLowerCase().includes('not logged in') || !status.stdout.trim()) {
    return {
      cliInstalled: true,
      cliVersion,
      termsAccepted: true,
      loggedIn: false,
      email: null,
      sessionExpiresAt: null,
      defaultChain: AEGIS_DEFAULT_CHAIN,
      maxPerCallUsdc: AEGIS_MAX_USDC_PER_CALL,
      message: 'Terms accepted but no active session. Run the bootstrap flow to log in via OTP.',
    };
  }

  let parsed: { data?: { email?: string; expiresAt?: string } } = {};
  try { parsed = JSON.parse(status.stdout); } catch { /* ignore */ }
  const result: AegisStatus = {
    cliInstalled: true,
    cliVersion,
    termsAccepted: true,
    loggedIn: true,
    email: parsed.data?.email ?? null,
    sessionExpiresAt: parsed.data?.expiresAt ?? null,
    defaultChain: AEGIS_DEFAULT_CHAIN,
    maxPerCallUsdc: AEGIS_MAX_USDC_PER_CALL,
    message: 'Aegis wallet session active.',
  };
  try { await redis.set(STATUS_CACHE_KEY, JSON.stringify(result), 'EX', STATUS_CACHE_TTL); } catch { /* ignore */ }
  return result;
}

export interface AegisWalletInfo {
  chain: string;
  address: string;
  balanceUsdc: string;
  gatewayBalanceUsdc: string;
}

export async function getAegisWallets(force = false): Promise<AegisWalletInfo[]> {
  // Redis cache: 14+ sequential CLI calls take ~30s. Cache for 60s.
  if (!force) {
    try {
      const cached = await redis.get(WALLETS_CACHE_KEY);
      if (cached) return JSON.parse(cached) as AegisWalletInfo[];
    } catch { /* ignore */ }
  }

  const list = await cliJson<{ data?: { wallets?: { chain: string; address: string }[] } }>(
    ['wallet', 'list', '--chain', AEGIS_DEFAULT_CHAIN, '--type', 'agent'],
  );
  const wallets = list?.data?.wallets ?? [];

  // Parallelize: 14+ CLI calls in parallel ≈ time of 1 call (3-5s) instead of summed (~30s)
  const out = await Promise.all(
    wallets.map(async (w) => {
      const [bal, gw] = await Promise.all([
        cliJson<{ data?: { balance?: string; usdc?: string } }>(
          ['wallet', 'balance', '--address', w.address, '--chain', w.chain],
          10_000,
        ).catch(() => null),
        cliJson<{ data?: { balance?: string; usdc?: string } }>(
          ['gateway', 'balance', '--address', w.address],
          10_000,
        ).catch(() => null),
      ]);
      return {
        chain: w.chain,
        address: w.address,
        balanceUsdc: bal?.data?.usdc ?? bal?.data?.balance ?? '0',
        gatewayBalanceUsdc: gw?.data?.usdc ?? gw?.data?.balance ?? '0',
      };
    }),
  );

  try { await redis.set(WALLETS_CACHE_KEY, JSON.stringify(out), 'EX', WALLETS_CACHE_TTL); } catch { /* ignore */ }
  return out;
}

export interface MarketplaceService {
  name: string;
  url: string;
  price: string;
  chains: string[];
  description?: string;
}

interface CliMarketItem {
  resource?: string;
  accepts?: Array<{
    amount?: string;
    network?: string;
    asset?: string;
    extra?: { chain?: string; name?: string };
  }>;
  metadata?: {
    provider?: { name?: string; description?: string; category?: string };
    path?: string;
    method?: string;
    description?: string;
    supportsCircleGateway?: boolean;
    supportsVanillax402?: boolean;
  };
}

function formatPriceUsd(amount: string | undefined): string {
  if (!amount) return '?';
  const n = parseFloat(amount);
  if (!isFinite(n)) return '?';
  // USDC has 6 decimals; payment amounts in Circle x402 marketplace are quoted in smallest units
  const usd = n / 1_000_000;
  if (usd < 0.01) return usd.toFixed(4);
  if (usd < 1) return usd.toFixed(3);
  return usd.toFixed(2);
}

export async function searchAegisServices(keyword: string, limit = 10, force = false): Promise<MarketplaceService[]> {
  if (!/^[a-zA-Z0-9_\-\s]{1,64}$/.test(keyword)) throw new Error('Invalid keyword');

  const cacheKey = `${MARKETPLACE_CACHE_PREFIX}${keyword.toLowerCase()}:${limit}`;
  if (!force) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as MarketplaceService[];
    } catch { /* ignore */ }
  }

  const r = await cliJson<{ data?: { items?: CliMarketItem[] } }>(
    ['services', 'search', keyword],
    20_000,
  );
  const items = r?.data?.items ?? [];
  const result = items.slice(0, limit).map((s) => {
    const acc = s.accepts ?? [];
    const chains = acc.map((a) => a.extra?.chain ?? a.network ?? '').filter(Boolean);
    const provider = s.metadata?.provider?.name ?? 'unknown';
    const path = s.metadata?.path ?? '';
    return {
      name: path ? `${provider} ${path.split('/').pop() ?? ''}`.trim() : provider,
      url: s.resource ?? '',
      price: formatPriceUsd(acc[0]?.amount),
      chains,
      description: s.metadata?.description ?? s.metadata?.provider?.description ?? undefined,
    };
  });

  try { await redis.set(cacheKey, JSON.stringify(result), 'EX', MARKETPLACE_CACHE_TTL); } catch { /* ignore */ }
  return result;
}

export interface PayResult {
  ok: boolean;
  serviceUrl: string;
  cost: string | null;
  txHash: string | null;
  response: unknown;
  error?: string;
}

export async function aegisPay(
  serviceUrl: string,
  opts: { chain?: string; data?: unknown; method?: string; maxAmount?: string } = {},
): Promise<PayResult> {
  if (!/^https?:\/\/[^\s]+$/.test(serviceUrl)) throw new Error('Invalid service URL');

  const status = await getAegisStatus();
  if (!status.loggedIn) {
    return { ok: false, serviceUrl, cost: null, txHash: null, response: null, error: 'Aegis wallet not bootstrapped' };
  }

  const wallets = await getAegisWallets();
  if (wallets.length === 0) {
    return { ok: false, serviceUrl, cost: null, txHash: null, response: null, error: 'No Aegis agent wallets found' };
  }

  const chain = (opts.chain || AEGIS_DEFAULT_CHAIN).toUpperCase();
  const wallet = wallets.find((w) => w.chain.toUpperCase() === chain) ?? wallets[0];

  const inspect = await cliJson<{ data?: { price?: string; method?: string; accepts?: unknown[] } }>(
    ['services', 'inspect', serviceUrl],
  );
  const method = (opts.method || inspect?.data?.method || 'GET').toUpperCase();
  const cost = inspect?.data?.price ?? null;

  // SECURITY: the shared operator-funded Aegis wallet must never spend above the
  // configured per-call cap, even if the caller passes a larger maxAmount. Clamp.
  const capUsdc = Number(AEGIS_MAX_USDC_PER_CALL);
  const requested = opts.maxAmount != null ? Number(opts.maxAmount) : capUsdc;
  const effectiveMax = Number.isFinite(requested) ? Math.min(requested, capUsdc) : capUsdc;

  const args = [
    'services', 'pay', serviceUrl,
    '-X', method,
    '--address', wallet.address,
    '--chain', wallet.chain,
    '--max-amount', String(effectiveMax),
  ];
  if (opts.data !== undefined) {
    args.push('--data', typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data));
  }
  const r = await cliJson<{ data?: { txHash?: string; response?: unknown }; error?: string }>(args, 60_000);
  if (!r || r.error) {
    return { ok: false, serviceUrl, cost, txHash: null, response: null, error: r?.error ?? 'pay command produced no output' };
  }
  logger.info('aegis', `Aegis paid ${cost ?? '?'} USDC for ${serviceUrl} on ${wallet.chain} tx ${r.data?.txHash ?? '-'}`);
  return {
    ok: true,
    serviceUrl,
    cost,
    txHash: r.data?.txHash ?? null,
    response: r.data?.response ?? null,
  };
}
