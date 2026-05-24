import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { createAgentWallet, isCircleConfigured, getAgentBalance, requestFaucet, ARC_NETWORK, withdrawFromAgentWallet, explorerTxUrl, explorerAddressUrl, listAgentTransactions, validateWithdrawDestination, estimateWithdrawFee, getTransactionInfo, accelerateAgentTransaction, cancelAgentTransaction, getTokenInfo, signWalletMessage, type WithdrawFeeLevel } from '../services/arckit';
import { getDestinationBalances, chainLabel, txExplorerForChain } from '../services/crossChain';
import { ARC_EXPLORER } from '../lib/chains';
import { evaluateAction } from '../services/guardian';
import { screenAddress } from '../services/compliance';
import { logAudit } from '../services/audit';
import { executeFxSwap } from '../services/arcFx';
import { getCurrentFxRate } from '../services/fxHedge';
import { getYieldRates, type YieldRate } from '../services/yieldRates';
import { redis } from '../lib/redis';
import { z } from 'zod';
import { logger } from '../lib/logger';

const swapSchema = z.object({
  amountEth: z.number().positive().finite().optional(),
  fromToken: z.string().min(1).max(10).regex(/^[A-Za-z0-9]+$/, 'Invalid token symbol').optional(),
  toToken:   z.string().min(1).max(10).regex(/^[A-Za-z0-9]+$/, 'Invalid token symbol').optional(),
  amount:    z.number().positive().finite().optional(),
}).refine(data => data.amountEth !== undefined || data.amount !== undefined, {
  message: 'Either amountEth or amount must be provided',
});

const limitsSchema = z.object({
  maxTxSizeUsd:          z.number().positive().finite().max(100_000).optional(),
  dailyLimitUsd:         z.number().positive().finite().max(500_000).optional(),
  approvalThresholdUsd:  z.number().positive().finite().max(100_000).optional(),
  slippagePercent:       z.number().min(0.01).max(50).optional(),
  allowedTokens:         z.array(z.string().min(1).max(10)).max(50).optional(),
});

export const agentWalletRouter = Router();
agentWalletRouter.use(requireAuth);

// GET /api/agent-wallet
agentWalletRouter.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const wallet = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { agentAddress: true, circleWalletId: true, maxTxSizeUsd: true, dailyLimitUsd: true, slippagePercent: true, allowedTokens: true, blockedTokens: true, isActive: true, network: true, createdAt: true },
  });

  if (!wallet) { res.json({ wallet: null }); return; }

  const balance = wallet.circleWalletId
    ? await getAgentBalance(wallet.circleWalletId)
    : { usdc: '0.00', eurc: '0.00' };
  res.json({ wallet: { ...wallet, balance, network: wallet.network } });

  // Save snapshot (non-blocking, 1h cooldown via Redis)
  const snapKey = `snapshot:${req.userId}`;
  const alreadySnapped = await redis.get(snapKey).catch((err) => { logger.warn('cache', 'Redis GET snapshot key failed', err); return null; });
  if (!alreadySnapped && balance) {
    const usdcBal = parseFloat(balance.usdc ?? '0');
    const eurcBal = parseFloat(balance.eurc ?? '0');
    const totalUsd = usdcBal + eurcBal;
    await prisma.portfolioSnapshot.create({
      data: { userId: req.userId!, ethBalance: 0, usdcBalance: usdcBal, ethPrice: 0, totalUsd, network: wallet.network },
    }).catch((err) => { logger.warn('portfolio', 'Portfolio snapshot creation failed', err); });
    await redis.set(snapKey, '1', 'EX', 3600).catch((err) => { logger.warn('cache', 'Redis SET snapshot cooldown failed', err); });
  }
});

// GET /api/agent-wallet/cross-chain. USDC balance across Arc + bridged destination chains
agentWalletRouter.get('/cross-chain', async (req: AuthRequest, res: Response): Promise<void> => {
  const wallet = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { agentAddress: true, circleWalletId: true },
  });
  if (!wallet?.agentAddress) { res.json({ chains: [], totalUsdc: 0 }); return; }

  const cacheKey = `agent:crosschain:${wallet.agentAddress}`;
  const skipCache = req.query.fresh === '1';
  if (!skipCache) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) { res.json(JSON.parse(cached)); return; }
    } catch (err) { logger.warn('cache', 'Redis GET cross-chain cache failed', err); }
  }

  const [arcBalance, destBalances] = await Promise.all([
    wallet.circleWalletId ? getAgentBalance(wallet.circleWalletId).catch(() => ({ usdc: '0.00', eurc: '0.00' })) : Promise.resolve({ usdc: '0.00', eurc: '0.00' }),
    getDestinationBalances(wallet.agentAddress).catch(() => []),
  ]);

  const arcEntry = {
    chain: 'arc-testnet',
    label: 'Arc',
    usdc: parseFloat(arcBalance.usdc ?? '0') || 0,
    addressExplorerUrl: `${ARC_EXPLORER}/address/${wallet.agentAddress}`,
    txExplorerBase: `${ARC_EXPLORER}/tx`,
    native: true,
  };

  const chains = [arcEntry, ...destBalances];
  const totalUsdc = chains.reduce((s, c) => s + (c.usdc || 0), 0);
  const response = { chains, totalUsdc, address: wallet.agentAddress };

  try { await redis.setex(cacheKey, 30, JSON.stringify(response)); } catch (err) { logger.warn('cache', 'Redis SETEX cross-chain cache failed', err); }
  res.json(response);
});

// GET /api/agent-wallet/tokens, fetch all token balances for the agent wallet
agentWalletRouter.get('/tokens', async (req: AuthRequest, res: Response): Promise<void> => {
  const wallet = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { agentAddress: true, circleWalletId: true, network: true, hiddenTokens: true },
  });

  if (!wallet) { res.json({ tokens: [], totalUsd: 0 }); return; }

  const hiddenSet = new Set((wallet.hiddenTokens ?? []).map((a: string) => a.toLowerCase()));

  // Redis cache (60s), avoid hammering Blockscout on every dashboard refresh
  // Skip cache when ?fresh=1 (used after swap to get updated balances)
  const skipCache = req.query.fresh === '1';
  const cacheKey = `agent:tokens:${wallet.agentAddress}`;
  if (!skipCache) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) { res.json(JSON.parse(cached)); return; }
    } catch (err) { logger.warn('cache', 'Redis GET token cache failed', err); }
  }

  const address = wallet.agentAddress;
  const BALANCE_OF = '0x70a08231';

  // RPC with retry across Arc providers
  const RPC_ENDPOINTS = ['https://rpc.testnet.arc.network', 'https://arc-testnet.drpc.org'];

  const rpcCall = async (method: string, params: unknown[]): Promise<string> => {
    for (const url of RPC_ENDPOINTS) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
          signal: AbortSignal.timeout(6000),
        });
        const d = await r.json() as { result?: string; error?: unknown };
        if (d.result && d.result !== '0x') return d.result;
        if (d.error) continue;
        return d.result ?? '0x0';
      } catch (err) { logger.warn('rpc', 'RPC call failed, trying next', err); continue; }
    }
    return '0x0';
  };

  // ── Arc testnet: USDC + EURC via Circle balance ─────────────────────────────
  if (wallet.circleWalletId) {
    const balance = await getAgentBalance(wallet.circleWalletId);
    const tokens = [];
    const usdcBal = parseFloat(balance.usdc);
    const eurcBal = parseFloat(balance.eurc);
    if (usdcBal > 0) {
      tokens.push({ symbol: 'USDC', name: 'USD Coin', logo: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png', balance: usdcBal, balanceFormatted: usdcBal.toFixed(2), priceUsd: 1, balanceUsd: usdcBal, contractAddress: '0x3600000000000000000000000000000000000000', isSuspicious: false });
    }
    if (eurcBal > 0) {
      const eurcUsd = (await getCurrentFxRate('EURC', 'USDC')) ?? 1;
      tokens.push({ symbol: 'EURC', name: 'Euro Coin', logo: '', balance: eurcBal, balanceFormatted: eurcBal.toFixed(2), priceUsd: eurcUsd, balanceUsd: eurcBal * eurcUsd, contractAddress: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', isSuspicious: false });
    }
    const totalUsd = tokens.reduce((s, t) => s + t.balanceUsd, 0);
    const response = { tokens, totalUsd, source: 'circle' };
    try { await redis.setex(cacheKey, 15, JSON.stringify(response)); } catch (err) { logger.warn('cache', 'Redis SETEX token cache failed', err); }
    res.json(response);
    return;
  }

  // ── Fallback: Arcscan API ───────────────────────────────────────────────────
  const tryArcscan = async () => {
    const txRes = await fetch(
      `https://testnet.arcscan.app/api/v2/addresses/${address}/token-transfers`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!txRes.ok) throw new Error(`Arcscan: ${txRes.status}`);
    const txData = await txRes.json() as {
      items: Array<{
        token: { address_hash: string; symbol: string; name: string; decimals: string; icon_url: string; exchange_rate: string | null };
        total: { value: string; decimals: string };
      }>;
    };
    if (!txData.items?.length) throw new Error('No token transfers found');

    const tokenMap = new Map<string, { symbol: string; name: string; decimals: number; contract: string; logo: string; price: number }>();
    for (const tx of txData.items) {
      const t = tx.token;
      if (!t?.address_hash || !t?.symbol) continue;
      const addr = t.address_hash.toLowerCase();
      if (!tokenMap.has(addr)) {
        tokenMap.set(addr, {
          symbol: t.symbol, name: t.name || t.symbol,
          decimals: parseInt(t.decimals) || 18,
          contract: t.address_hash,
          logo: t.icon_url || '',
          price: parseFloat(t.exchange_rate || '0'),
        });
      }
    }

    const paddedAddr = address.toLowerCase().slice(2).padStart(64, '0');
    const tokenList = Array.from(tokenMap.values());
    const erc20 = await Promise.all(
      tokenList.map(async (token) => {
        try {
          const hex = await rpcCall('eth_call', [
            { to: token.contract.toLowerCase(), data: BALANCE_OF + paddedAddr },
            'latest',
          ]);
          return { ...token, balance: Number(BigInt(hex || '0x0')) / Math.pow(10, token.decimals) };
        } catch (err) {
          logger.warn('balance', 'Balance fetch failed, defaulting to 0', { address, token: token.symbol, error: (err as Error).message });
          return { ...token, balance: 0 };
        }
      })
    );

    const withBalance = erc20.filter((t) => t.balance > 0);
    return { erc20Tokens: withBalance };
  };

  try {
    const { erc20Tokens } = await tryArcscan();
    const tokens = erc20Tokens
      .filter(t => !hiddenSet.has(t.contract.toLowerCase()))
      .map(t => ({
        symbol: t.symbol, name: t.name, logo: t.logo,
        balance: t.balance,
        balanceFormatted: t.decimals <= 6 ? t.balance.toFixed(2) : t.balance.toFixed(4),
        priceUsd: t.price, balanceUsd: t.balance * t.price,
        contractAddress: t.contract, isSuspicious: t.price === 0 && !t.logo,
      }));
    tokens.sort((a, b) => b.balanceUsd - a.balanceUsd);
    const totalUsd = tokens.reduce((s, t) => s + t.balanceUsd, 0);
    const response = { tokens, totalUsd, source: 'arcscan' };
    try { await redis.setex(cacheKey, 15, JSON.stringify(response)); } catch (err) { logger.warn('cache', 'Redis SETEX token cache failed', err); }
    res.json(response);
  } catch (err) {
    logger.warn('rpc', 'Arcscan failed, returning empty', err);
    res.json({ tokens: [], totalUsd: 0, source: 'error' });
  }
});

// GET /api/portfolio/user-balances, fetch ALL token balances on Arc
agentWalletRouter.get('/user-balances', async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { walletAddress: true },
  });
  if (!user?.walletAddress) { res.json({ balances: [] }); return; }

  const address = user.walletAddress;

  // Redis cache (60s)
  const cacheKey = `user:balances:${address}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) { res.json(JSON.parse(cached)); return; }
  } catch (err) { logger.warn('cache', 'Redis GET user-balances cache failed', err); }

  // ── Helper: RPC call with retry ─────────────────────────────────────────────
  const USER_RPCS = ['https://rpc.testnet.arc.network', 'https://arc-testnet.drpc.org'];
  const BALANCE_OF = '0x70a08231';

  const rpcCall = async (method: string, params: unknown[]): Promise<string> => {
    for (const url of USER_RPCS) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
          signal: AbortSignal.timeout(6000),
        });
        const d = await r.json() as { result?: string; error?: unknown };
        if (d.result && d.result !== '0x') return d.result;
        if (d.error) continue;
        return d.result ?? '0x0';
      } catch (err) { logger.warn('rpc', 'RPC call failed, trying next', err); continue; }
    }
    return '0x0';
  };

  // ── Helper: format balance result ──────────────────────────────────────────
  type BalanceItem = {
    symbol: string; name: string; logo: string;
    contractAddress: string | null; explorerUrl: string | null;
    balance: string; balanceUsd: number; price: number;
    isSuspicious?: boolean;
  };

  // ── Strategy 1: Arcscan API ────────────────────────────────────────────────
  const tryArcscan = async (): Promise<BalanceItem[]> => {
    const txRes = await fetch(
      `https://testnet.arcscan.app/api/v2/addresses/${address}/token-transfers`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!txRes.ok) throw new Error(`Arcscan: ${txRes.status}`);
    const txData = await txRes.json() as {
      items: Array<{ token: { address_hash: string; symbol: string; name: string; decimals: string; icon_url: string } }>;
    };
    if (!txData.items?.length) throw new Error('No token transfers');

    const tokenMap = new Map<string, { symbol: string; name: string; decimals: number; contract: string; logo: string }>();
    for (const tx of txData.items) {
      const t = tx.token;
      const addr = t.address_hash.toLowerCase();
      if (!tokenMap.has(addr)) tokenMap.set(addr, { symbol: t.symbol, name: t.name, decimals: parseInt(t.decimals) || 18, contract: t.address_hash, logo: t.icon_url || '' });
    }

    const erc20 = await Promise.all(Array.from(tokenMap.values()).map(async (token) => {
      try {
        const data = BALANCE_OF + address.slice(2).padStart(64, '0');
        const hex = await rpcCall('eth_call', [{ to: token.contract, data }, 'latest']);
        return { ...token, balance: Number(BigInt(hex || '0x0')) / Math.pow(10, token.decimals) };
      } catch (err) { logger.warn('balance', 'Balance fetch failed, defaulting to 0', { address, token: token.symbol, error: (err as Error).message }); return { ...token, balance: 0 }; }
    }));

    const nonZero = erc20.filter((t) => t.balance > 0);

    const tokenPrices = await Promise.all(
      nonZero.map(async (token) => {
        try {
          const tRes = await fetch(`https://testnet.arcscan.app/api/v2/tokens/${token.contract}`, { signal: AbortSignal.timeout(5000) });
          if (!tRes.ok) return { contract: token.contract, price: 0, icon: token.logo };
          const tData = await tRes.json() as { exchange_rate?: string; icon_url?: string };
          return { contract: token.contract, price: parseFloat(tData.exchange_rate || '0'), icon: tData.icon_url || token.logo };
        } catch (err) { logger.warn('price', 'Token price fetch failed', err); return { contract: token.contract, price: 0, icon: token.logo }; }
      })
    );
    const priceMap = new Map(tokenPrices.map((p) => [p.contract.toLowerCase(), p]));

    const balances: BalanceItem[] = [];
    for (const token of nonZero) {
      const info = priceMap.get(token.contract.toLowerCase());
      const price = info?.price ?? 0;
      const isSuspicious = price === 0 && !(info?.icon);
      balances.push({ symbol: token.symbol, name: token.name, logo: info?.icon || token.logo, contractAddress: token.contract, explorerUrl: explorerAddressUrl(token.contract), balance: token.balance.toFixed(token.decimals > 6 ? 6 : token.decimals), balanceUsd: token.balance * price, price, isSuspicious });
    }
    return balances.sort((a, b) => b.balanceUsd - a.balanceUsd);
  };

  // ── Execute cascade: Arcscan → RPC ─────────────────────────────────────────
  try {
    const balances = await tryArcscan();
    const response = { balances, walletAddress: address, source: 'arcscan' };
    try { await redis.setex(cacheKey, 15, JSON.stringify(response)); } catch (err) { logger.warn('cache', 'Redis SETEX user-balances cache failed', err); }
    res.json(response);
  } catch (err1) {
    logger.warn('agentWallet', `[user-balances] Arcscan failed: ${(err1 as Error).message}`);
    try {
      const hex = await rpcCall('eth_getBalance', [address, 'latest']);
      const ethBalance = Number(BigInt(hex || '0x0')) / 1e18;
      const balances: BalanceItem[] = ethBalance > 0.0001 ? [{ symbol: 'ETH', name: 'Ethereum', logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', contractAddress: null, explorerUrl: null, balance: ethBalance.toFixed(6), balanceUsd: 0, price: 0 }] : [];
      res.json({ balances, walletAddress: address, source: 'rpc' });
    } catch (err) {
      logger.warn('rpc', 'RPC call failed', err);
      res.json({ balances: [], walletAddress: address, source: 'error' });
    }
  }
});

// GET /api/portfolio/history
agentWalletRouter.get('/history', async (req: AuthRequest, res: Response): Promise<void> => {
  const days = Math.min(Number(req.query.days) || 7, 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const snapshots = await prisma.portfolioSnapshot.findMany({
    where: { userId: req.userId!, createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    select: { totalUsd: true, ethBalance: true, usdcBalance: true, ethPrice: true, createdAt: true },
  });
  res.json({ snapshots });
});

// POST /api/agent-wallet/create
agentWalletRouter.post('/create', async (req: AuthRequest, res: Response): Promise<void> => {
  // First: check if this userId already has a wallet
  const existing = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { agentAddress: true, circleWalletId: true, isActive: true, maxTxSizeUsd: true, dailyLimitUsd: true, network: true },
  });
  if (existing) {
    const balance = existing.circleWalletId
      ? await getAgentBalance(existing.circleWalletId)
      : { usdc: '0.00', eurc: '0.00' };
    res.json({ wallet: { agentAddress: existing.agentAddress, isActive: existing.isActive, maxTxSizeUsd: existing.maxTxSizeUsd, dailyLimitUsd: existing.dailyLimitUsd, balance, network: existing.network } });
    return;
  }

  if (!isCircleConfigured()) {
    res.status(503).json({ error: 'Circle Wallets not configured' });
    return;
  }

  if (!req.walletAddress) {
    res.status(400).json({ error: 'Wallet address required' });
    return;
  }

  try {
    const { address, walletId, walletSetId } = await createAgentWallet(req.walletAddress!);

    // Check if another user already has this agent wallet (migration edge case)
    const existingByAgent = await prisma.agentWallet.findUnique({ where: { agentAddress: address } });
    if (existingByAgent) {
      if (existingByAgent.userId !== req.userId) {
        await prisma.agentWallet.update({
          where: { agentAddress: address },
          data: { userId: req.userId! },
        });
      }
      const balance = existingByAgent.circleWalletId
        ? await getAgentBalance(existingByAgent.circleWalletId)
        : { usdc: '0.00', eurc: '0.00' };
      res.json({ wallet: { agentAddress: address, isActive: existingByAgent.isActive, maxTxSizeUsd: existingByAgent.maxTxSizeUsd, dailyLimitUsd: existingByAgent.dailyLimitUsd, balance, network: ARC_NETWORK } });
      return;
    }

    const wallet = await prisma.agentWallet.create({
      data: {
        userId: req.userId!,
        agentAddress: address,
        circleWalletId: walletId,
        circleWalletSetId: walletSetId,
        network: ARC_NETWORK,
        allowedTokens: ['USDC', 'EURC'],
        maxTxSizeUsd: 100,
        dailyLimitUsd: 500,
      },
    });
    const balance = await getAgentBalance(walletId);
    res.status(201).json({ wallet: { agentAddress: wallet.agentAddress, isActive: wallet.isActive, maxTxSizeUsd: wallet.maxTxSizeUsd, dailyLimitUsd: wallet.dailyLimitUsd, balance, network: ARC_NETWORK } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('agentWallet', `Circle wallet creation failed: ${msg}`);
    if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('resource_exhausted')) {
      res.status(429).json({ error: 'Rate limit, please wait 1 minute and try again' });
    } else {
      logger.error('wallet', 'Wallet creation failed', err);
      res.status(500).json({ error: 'Failed to create wallet. Please try again.' });
    }
  }
});

// POST /api/agent-wallet/faucet, request testnet tokens (Arc testnet only)
agentWalletRouter.post('/faucet', async (req: AuthRequest, res: Response): Promise<void> => {
  if (ARC_NETWORK !== 'arc-testnet') {
    res.status(400).json({ error: 'Faucet only available on Arc testnet' });
    return;
  }
  const faucetWallet = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { circleWalletId: true },
  });
  if (!faucetWallet?.circleWalletId) {
    res.status(400).json({ error: 'Agent wallet not found' });
    return;
  }

  const body = (req.body ?? {}) as { usdc?: boolean; eurc?: boolean; native?: boolean };
  const anySelected = body.usdc === true || body.eurc === true || body.native === true;
  const tokens = anySelected
    ? { usdc: body.usdc === true, eurc: body.eurc === true, native: body.native === true }
    : { usdc: true };

  try {
    const result = await requestFaucet(faucetWallet.circleWalletId, tokens);
    const label = result.tokens.join(', ') || 'USDC';
    res.json({ status: result.status, address: result.address, tokens: result.tokens, message: `Requested ${label} from the Circle faucet. It can take up to a minute to arrive.` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const refusal = /rate limit/i.test(msg) ? 429 : /forbidden/i.test(msg) ? 403 : null;
    if (refusal) {
      logger.warn('faucet', `Circle faucet refused: ${msg}`, { tokens });
      res.status(refusal).json({ error: `Circle faucet refused the request (${msg}). Testnet drips are capped per wallet - try again later.` });
      return;
    }
    logger.error('faucet', 'Faucet request failed', err);
    res.status(500).json({ error: 'Faucet request failed. Please try again.' });
  }
});

// GET /api/agent-wallet/token/:id, look up Circle token metadata by token id
agentWalletRouter.get('/token/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const tokenId = req.params.id;
  if (!UUID_RE.test(tokenId)) { res.status(400).json({ error: 'Invalid token id' }); return; }
  if (!isCircleConfigured()) { res.status(503).json({ error: 'Circle Wallets not configured' }); return; }
  try {
    const token = await getTokenInfo(tokenId);
    if (!token) { res.status(404).json({ error: 'Token not found' }); return; }
    res.json({ token });
  } catch (err) {
    logger.error('token', 'Token lookup failed', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Token lookup failed' });
  }
});

// POST /api/agent-wallet/sign-message, sign an arbitrary message with the agent wallet key
agentWalletRouter.post('/sign-message', async (req: AuthRequest, res: Response): Promise<void> => {
  const { message } = req.body as { message?: string };
  if (typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'message is required' }); return;
  }
  if (message.length > 2000) {
    res.status(400).json({ error: 'message must be 2000 characters or fewer' }); return;
  }
  if (!isCircleConfigured()) { res.status(503).json({ error: 'Circle Wallets not configured' }); return; }

  const signWallet = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { circleWalletId: true, isActive: true },
  });
  if (!signWallet?.circleWalletId) { res.status(400).json({ error: 'Agent wallet not configured' }); return; }
  if (!signWallet.isActive) { res.status(403).json({ error: 'Agent wallet disabled' }); return; }

  try {
    const signed = await signWalletMessage(signWallet.circleWalletId, message);
    await logAudit({ userId: req.userId!, actor: req.userId!, action: 'MESSAGE_SIGNED', detail: { length: message.length } });
    res.json({ message: signed.message, signature: signed.signature });
  } catch (err) {
    logger.error('sign', 'Message signing failed', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Message signing failed' });
  }
});

// POST /api/agent-wallet/swap
agentWalletRouter.post('/swap', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = swapSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const wallet = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { circleWalletId: true, isActive: true, maxTxSizeUsd: true, slippagePercent: true, blockedTokens: true },
  });

  if (!wallet?.circleWalletId) { res.status(400).json({ error: 'Agent wallet not configured' }); return; }
  if (!wallet.isActive) { res.status(403).json({ error: 'Agent wallet disabled' }); return; }

  const { fromToken = 'USDC', toToken = 'EURC', amount, amountEth } = parsed.data;
  const swapAmount = amount ?? amountEth ?? 0;

  if (wallet.blockedTokens?.includes(toToken.toUpperCase())) {
    res.status(400).json({ error: `Token ${toToken} is blocked` }); return;
  }

  // Enforce the same spending guardrails as every other swap path (chat/bot/limit/dca)
  // and the withdraw handler. A direct REST swap must NOT bypass per-tx / daily / Guardian.
  let swapUsd = swapAmount;
  if (fromToken.toUpperCase() === 'EURC') {
    const eurcUsd = await getCurrentFxRate('EURC', 'USDC');
    swapUsd = eurcUsd != null ? swapAmount * eurcUsd : swapAmount;
  }
  if (swapUsd > wallet.maxTxSizeUsd) {
    res.status(400).json({ error: `Swap value ~$${swapUsd.toFixed(2)} exceeds your $${wallet.maxTxSizeUsd} per-transaction limit. Adjust in Settings.` });
    return;
  }
  const guard = await evaluateAction(req.userId!, { action: 'WITHDRAW', amountUsd: swapUsd, token: fromToken.toUpperCase() });
  if (guard.result.decision === 'DENY') {
    res.status(403).json({ error: `Guardian policy blocked this swap: ${guard.result.reasons.join('; ')}`, decision: 'DENY', reasons: guard.result.reasons });
    return;
  }
  if (guard.result.decision === 'REQUIRE_APPROVAL') {
    res.status(403).json({ error: `This swap (~$${swapUsd.toFixed(2)}) exceeds your approval threshold. Approve it via the agent chat, or raise the threshold in Settings.`, decision: 'REQUIRE_APPROVAL', reasons: guard.result.reasons });
    return;
  }

  let result;
  try {
    result = await executeFxSwap(wallet.circleWalletId, fromToken, toToken, String(swapAmount), Math.round((wallet.slippagePercent ?? 0.5) * 100));
  } catch (err) {
    const isRouteUnavailable = err instanceof Error && (err as { code?: string }).code === 'SWAP_ROUTE_UNAVAILABLE';
    if (isRouteUnavailable) logger.warn('swap', 'Swap route unavailable', err instanceof Error ? err.message : err);
    else logger.error('swap', 'Swap failed', err);
    res.status(isRouteUnavailable ? 503 : 500).json({ error: err instanceof Error ? err.message : 'Swap failed' });
    return;
  }

  await prisma.agentTransaction.create({
    data: {
      userId: req.userId!,
      type: 'SWAP',
      tokenIn: fromToken.toUpperCase(),
      tokenOut: toToken.toUpperCase(),
      amount: swapAmount.toString(),
      txHash: result.txHash,
      status: 'SUCCESS',
      network: ARC_NETWORK,
    },
  }).catch((err: any) => logger.warn('db', 'Failed to log swap transaction', err));

  res.json({ result });
});

// PUT /api/agent-wallet/network, save user's selected network preference
agentWalletRouter.put('/network', async (req: AuthRequest, res: Response): Promise<void> => {
  const { network } = req.body as { network: string };
  if (network !== 'arc-testnet' && network !== 'arc-mainnet') {
    res.status(400).json({ error: 'Invalid network' });
    return;
  }
  const wallet = await prisma.agentWallet.findUnique({ where: { userId: req.userId! } });
  if (!wallet) { res.status(404).json({ error: 'No agent wallet found' }); return; }
  await prisma.agentWallet.update({
    where: { userId: req.userId! },
    data: { network },
  });
  res.json({ network });
});

// PUT /api/agent-wallet/slippage, update default slippage tolerance
agentWalletRouter.put('/slippage', async (req: AuthRequest, res: Response): Promise<void> => {
  const { slippagePercent } = req.body as { slippagePercent: number };
  const val = Number(slippagePercent);
  if (isNaN(val) || val < 0.01 || val > 50) {
    res.status(400).json({ error: 'Slippage must be between 0.01% and 50%' });
    return;
  }
  const wallet = await prisma.agentWallet.findUnique({ where: { userId: req.userId! } });
  if (!wallet) { res.status(404).json({ error: 'No agent wallet found' }); return; }
  await prisma.agentWallet.update({
    where: { userId: req.userId! },
    data: { slippagePercent: val },
  });
  res.json({ slippagePercent: val });
});

// PUT /api/agent-wallet/allowed-tokens
agentWalletRouter.put('/allowed-tokens', async (req: AuthRequest, res: Response): Promise<void> => {
  const { allowedTokens } = req.body as { allowedTokens: string[] };
  if (!Array.isArray(allowedTokens) || allowedTokens.length > 50) {
    res.status(400).json({ error: 'allowedTokens must be an array of up to 50 token symbols' });
    return;
  }
  const clean = allowedTokens.map((t: string) => String(t).toUpperCase().trim()).filter(Boolean);
  const wallet = await prisma.agentWallet.findUnique({ where: { userId: req.userId! } });
  if (!wallet) { res.status(404).json({ error: 'No agent wallet found' }); return; }
  await prisma.agentWallet.update({ where: { userId: req.userId! }, data: { allowedTokens: clean } });
  res.json({ allowedTokens: clean });
});

// PUT /api/agent-wallet/blocked-tokens
agentWalletRouter.put('/blocked-tokens', async (req: AuthRequest, res: Response): Promise<void> => {
  const { blockedTokens } = req.body as { blockedTokens: string[] };
  if (!Array.isArray(blockedTokens) || blockedTokens.length > 50) {
    res.status(400).json({ error: 'blockedTokens must be an array of up to 50 token symbols' });
    return;
  }
  const clean = blockedTokens.map((t: string) => String(t).toUpperCase().trim()).filter(Boolean);
  const wallet = await prisma.agentWallet.findUnique({ where: { userId: req.userId! } });
  if (!wallet) { res.status(404).json({ error: 'No agent wallet found' }); return; }
  await prisma.agentWallet.update({ where: { userId: req.userId! }, data: { blockedTokens: clean } });
  res.json({ blockedTokens: clean });
});

// PUT /api/agent-wallet/limits
// GET /api/agent-wallet/transactions, merged on-chain + DB history
agentWalletRouter.get('/transactions', async (req: AuthRequest, res: Response): Promise<void> => {
  // Redis cache (60s) for history
  const walletForCache = await prisma.agentWallet.findUnique({ where: { userId: req.userId! }, select: { agentAddress: true } });
  if (walletForCache?.agentAddress) {
    try {
      const cached = await redis.get(`agent:history:${walletForCache.agentAddress}`);
      if (cached) { res.json(JSON.parse(cached)); return; }
    } catch (err) { logger.warn('cache', 'Redis GET history cache failed', err); }
  }

  // 1. DB transactions (swaps, withdrawals by agent)
  const dbTxs = await prisma.agentTransaction.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, type: true, tokenIn: true, tokenOut: true, amount: true, amountUsd: true, txHash: true, toAddress: true, status: true, network: true, createdAt: true },
  });

  // 1b. Bridge transactions (cross-chain CCTP transfers)
  const bridgeTxs = await prisma.bridgeTransaction.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, fromChain: true, toChain: true, fromToken: true, toToken: true, amount: true, status: true, txHash: true, destinationTxHash: true, createdAt: true },
  });

  const bridgeMapped = bridgeTxs.map((b) => ({
    id: 'bridge-' + b.id,
    type: 'BRIDGE',
    tokenIn: b.fromToken,
    tokenOut: b.toToken,
    amount: b.amount,
    amountUsd: parseFloat(b.amount) || null,
    txHash: b.txHash ?? b.destinationTxHash ?? null,
    toAddress: null as string | null,
    fromAddress: null as string | null,
    status: b.status,
    network: b.fromChain,
    detail: `${b.amount} ${b.fromToken} · ${chainLabel(b.fromChain)} → ${chainLabel(b.toChain)}`,
    sourceExplorerUrl: txExplorerForChain(b.fromChain, b.txHash ?? ''),
    destExplorerUrl: txExplorerForChain(b.toChain, b.destinationTxHash ?? ''),
    createdAt: b.createdAt,
  }));

  // 2. On-chain transfers via Circle's native listTransactions
  const wallet = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { circleWalletId: true },
  });

  let onChainTxs: Array<{
    id: string; type: string; tokenIn: string; tokenOut: string;
    amount: string; amountUsd: number | null; txHash: string | null;
    toAddress: string | null; fromAddress: string | null;
    status: string; network: string; createdAt: string;
  }> = [];

  if (wallet?.circleWalletId) {
    try {
      onChainTxs = await listAgentTransactions(wallet.circleWalletId);
    } catch (err) {
      logger.warn('history', 'listTransactions failed', err);
    }
  }

  // 3. Merge: DB txs take priority (by txHash), then add on-chain ones not in DB
  const dbHashes = new Set(dbTxs.filter((t) => t.txHash).map((t) => t.txHash!.toLowerCase()));
  const uniqueOnChain = onChainTxs.filter((t) => {
    if (t.txHash && dbHashes.has(t.txHash.toLowerCase())) return false;
    const amt = parseFloat(t.amount);
    if (amt < 0.0001) return false;
    return true;
  });

  const allTxs = [
    ...dbTxs.map((t) => ({ ...t, fromAddress: null as string | null })),
    ...bridgeMapped,
    ...uniqueOnChain,
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 100);

  const response = { transactions: allTxs };
  if (walletForCache?.agentAddress) {
    try { await redis.setex(`agent:history:${walletForCache.agentAddress}`, 60, JSON.stringify(response)); } catch (err) { logger.warn('cache', 'Redis SETEX history cache failed', err); }
  }
  res.json(response);
});

const ETH_ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleTxAction(req: AuthRequest, res: Response, action: 'accelerate' | 'cancel'): Promise<void> {
  const txId = req.params.id;
  if (!UUID_RE.test(txId)) { res.status(400).json({ error: 'Invalid transaction id' }); return; }
  if (!isCircleConfigured()) { res.status(503).json({ error: 'Circle Wallets not configured' }); return; }

  const wallet = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { circleWalletId: true, agentAddress: true, isActive: true },
  });
  if (!wallet?.circleWalletId) { res.status(400).json({ error: 'Agent wallet not configured' }); return; }
  if (!wallet.isActive) { res.status(403).json({ error: 'Agent wallet disabled' }); return; }

  try {
    const info = await getTransactionInfo(txId);
    if (!info) { res.status(404).json({ error: 'Transaction not found' }); return; }
    if (info.walletId && info.walletId !== wallet.circleWalletId) {
      res.status(403).json({ error: 'Transaction does not belong to your wallet' }); return;
    }
    if (info.terminal) {
      res.status(409).json({ error: `Transaction already in terminal state ${info.state} and cannot be ${action === 'accelerate' ? 'accelerated' : 'cancelled'}`, state: info.state }); return;
    }

    const result = action === 'accelerate'
      ? await accelerateAgentTransaction(txId)
      : await cancelAgentTransaction(txId);

    await logAudit({ userId: req.userId!, actor: req.userId!, action: action === 'accelerate' ? 'TX_ACCELERATED' : 'TX_CANCELLED', detail: { txId, previousState: info.state } });
    if (wallet.agentAddress) {
      try { await redis.del(`agent:history:${wallet.agentAddress}`); } catch (err) { logger.warn('cache', 'Redis DEL history cache after tx action failed', err); }
    }
    res.json({ result });
  } catch (err) {
    logger.error('tx-action', `${action} failed`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : `${action} failed` });
  }
}

agentWalletRouter.post('/transactions/:id/accelerate', (req: AuthRequest, res: Response) => handleTxAction(req, res, 'accelerate'));

agentWalletRouter.post('/transactions/:id/cancel', (req: AuthRequest, res: Response) => handleTxAction(req, res, 'cancel'));

// POST /api/agent-wallet/hide-token, hide a token from dashboard (mark as scam)
agentWalletRouter.post('/hide-token', async (req: AuthRequest, res: Response): Promise<void> => {
  const { contractAddress } = req.body as { contractAddress?: string };
  if (!contractAddress || !ETH_ADDR_RE.test(contractAddress)) { res.status(400).json({ error: 'Valid contract address required' }); return; }

  const wallet = await prisma.agentWallet.findUnique({ where: { userId: req.userId! }, select: { hiddenTokens: true } });
  if (!wallet) { res.status(404).json({ error: 'No wallet' }); return; }

  const addr = contractAddress.toLowerCase();
  const current = (wallet.hiddenTokens ?? []).map((a: string) => a.toLowerCase());
  if (!current.includes(addr)) {
    current.push(addr);
    await prisma.agentWallet.update({ where: { userId: req.userId! }, data: { hiddenTokens: current } });
  }
  try { const w = await prisma.agentWallet.findUnique({ where: { userId: req.userId! }, select: { agentAddress: true } }); if (w) await redis.del(`agent:tokens:${w.agentAddress}`); } catch (err) { logger.warn('cache', 'Redis DEL token cache after hide failed', err); }
  res.json({ ok: true, hiddenTokens: current });
});

// POST /api/agent-wallet/unhide-token, restore a hidden token
agentWalletRouter.post('/unhide-token', async (req: AuthRequest, res: Response): Promise<void> => {
  const { contractAddress } = req.body as { contractAddress?: string };
  if (!contractAddress || !ETH_ADDR_RE.test(contractAddress)) { res.status(400).json({ error: 'Valid contract address required' }); return; }

  const wallet = await prisma.agentWallet.findUnique({ where: { userId: req.userId! }, select: { hiddenTokens: true } });
  if (!wallet) { res.status(404).json({ error: 'No wallet' }); return; }

  const addr = contractAddress.toLowerCase();
  const updated = (wallet.hiddenTokens ?? []).filter((a: string) => a.toLowerCase() !== addr);
  await prisma.agentWallet.update({ where: { userId: req.userId! }, data: { hiddenTokens: updated } });
  try { const w = await prisma.agentWallet.findUnique({ where: { userId: req.userId! }, select: { agentAddress: true } }); if (w) await redis.del(`agent:tokens:${w.agentAddress}`); } catch (err) { logger.warn('cache', 'Redis DEL token cache after unhide failed', err); }
  res.json({ ok: true, hiddenTokens: updated });
});

// GET /api/agent-wallet/hidden-tokens, list hidden tokens
agentWalletRouter.get('/hidden-tokens', async (req: AuthRequest, res: Response): Promise<void> => {
  const wallet = await prisma.agentWallet.findUnique({ where: { userId: req.userId! }, select: { hiddenTokens: true } });
  res.json({ hiddenTokens: wallet?.hiddenTokens ?? [] });
});

agentWalletRouter.put('/limits', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = limitsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { maxTxSizeUsd, dailyLimitUsd, approvalThresholdUsd, slippagePercent, allowedTokens } = parsed.data;

  const wallet = await prisma.agentWallet.findUnique({ where: { userId: req.userId! } });
  if (!wallet) { res.status(404).json({ error: 'No agent wallet found' }); return; }

  if (maxTxSizeUsd !== undefined && dailyLimitUsd !== undefined && maxTxSizeUsd > dailyLimitUsd) {
    res.status(400).json({ error: 'Max transaction size cannot exceed the daily limit' }); return;
  }

  const updated = await prisma.agentWallet.update({
    where: { userId: req.userId! },
    data: {
      ...(maxTxSizeUsd !== undefined && { maxTxSizeUsd }),
      ...(dailyLimitUsd !== undefined && { dailyLimitUsd }),
      ...(approvalThresholdUsd !== undefined && { approvalThresholdUsd }),
      ...(slippagePercent !== undefined && { slippagePercent }),
      ...(allowedTokens !== undefined && { allowedTokens }),
    },
    select: { agentAddress: true, maxTxSizeUsd: true, dailyLimitUsd: true, approvalThresholdUsd: true, slippagePercent: true, allowedTokens: true },
  });
  res.json({ wallet: updated });
});

// POST /api/agent-wallet/check-dead-capital, trigger dead capital check for this user
agentWalletRouter.post('/check-dead-capital', async (req: AuthRequest, res: Response): Promise<void> => {
  const wallet = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { circleWalletId: true, createdAt: true, network: true },
  });
  if (!wallet) { res.status(404).json({ error: 'No wallet' }); return; }

  await redis.del(`dead_capital_check:${req.userId!}`);

  const balance = wallet.circleWalletId
    ? await getAgentBalance(wallet.circleWalletId)
    : { usdc: '0.00', eurc: '0.00' };
  const usdcBal = parseFloat(balance.usdc ?? '0');
  const eurcBal = parseFloat(balance.eurc ?? '0');
  const totalUsd = usdcBal + eurcBal;

  const usdcStr = usdcBal > 0.01 ? `${usdcBal.toFixed(2)} USDC` : '';
  const eurcStr = eurcBal > 0.01 ? `${eurcBal.toFixed(2)} EURC` : '';
  const assetsStr = [usdcStr, eurcStr].filter(Boolean).join(' and ') || 'assets';

  const yieldRates = await getYieldRates();
  const stableYields = yieldRates.filter((r: YieldRate) => /USDC|USDT|DAI|EURC/i.test(r.token)).slice(0, 3);
  const yieldLines: string[] = [];
  if ((usdcBal > 1 || eurcBal > 1) && stableYields.length > 0) {
    for (const r of stableYields) yieldLines.push(`• ${r.protocol}: ${r.token} ${r.apy}% APY, ${r.url}`);
  }
  const insuranceLine = '🛡️ All yield protocols above are battle-tested and audited. Always DYOR.';
  const suggestionLines = yieldLines.length > 0
    ? yieldLines
    : [`• Fund your wallet with USDC or EURC to get personalized recommendations`];

  const walletAgeDays = Math.floor((Date.now() - wallet.createdAt.getTime()) / 86400000);
  const chatContent =
    `💤 Idle Capital Detected\n\n` +
    `Your GuardAgent wallet has ${assetsStr || 'assets'} sitting idle for ${walletAgeDays || 'several'} day${walletAgeDays === 1 ? '' : 's'}, earning nothing. ` +
    `You can increase your returns without leaving your security parameters.\n\n` +
    `📈 Live rates on Arc:\n` +
    suggestionLines.join('\n') +
    `\n\n${insuranceLine}` +
    `\n\nTotal idle value: ~$${totalUsd.toFixed(0)}`;

  await prisma.chatMessage.create({
    data: { userId: req.userId!, role: 'assistant', content: chatContent },
  });

  res.json({ success: true, totalUsd: totalUsd.toFixed(0), usdc: usdcBal, eurc: eurcBal });
});

// POST /api/agent-wallet/withdraw/estimate, preview LOW/MEDIUM/HIGH network fees + destination safety
agentWalletRouter.post('/withdraw/estimate', async (req: AuthRequest, res: Response): Promise<void> => {
  const { token, amount, toAddress } = req.body as { token: string; amount: number; toAddress: string };
  if (!token || typeof token !== 'string') { res.status(400).json({ error: 'token is required' }); return; }
  if (typeof amount !== 'number' || amount <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  if (!toAddress || !/^0x[0-9a-fA-F]{40}$/.test(toAddress)) { res.status(400).json({ error: 'Invalid destination address' }); return; }
  if (!isCircleConfigured()) { res.status(503).json({ error: 'Circle Wallets not configured' }); return; }

  const estWallet = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { circleWalletId: true },
  });
  if (!estWallet?.circleWalletId) { res.status(400).json({ error: 'Agent wallet not configured' }); return; }

  const sym = token.toUpperCase();
  try {
    const [fees, destination] = await Promise.all([
      estimateWithdrawFee(estWallet.circleWalletId, sym, amount, toAddress),
      validateWithdrawDestination(toAddress, sym),
    ]);
    res.json({ fees, destination });
  } catch (err) {
    logger.error('withdraw', 'fee estimate failed', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Fee estimate failed' });
  }
});

// POST /api/agent-wallet/withdraw, withdraw any supported token from agent wallet
agentWalletRouter.post('/withdraw', async (req: AuthRequest, res: Response): Promise<void> => {
  const { token, amount, toAddress, feeLevel: feeLevelRaw } = req.body as { token: string; amount: number; toAddress: string; feeLevel?: string };

  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'token is required' }); return;
  }
  const sym = token.toUpperCase();
  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' }); return;
  }
  if (!toAddress || !/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
    res.status(400).json({ error: 'Invalid destination address' }); return;
  }
  const feeLevel: WithdrawFeeLevel = ['LOW', 'MEDIUM', 'HIGH'].includes((feeLevelRaw || '').toUpperCase())
    ? ((feeLevelRaw as string).toUpperCase() as WithdrawFeeLevel)
    : 'MEDIUM';

  if (!isCircleConfigured()) {
    res.status(503).json({ error: 'Circle Wallets not configured' }); return;
  }

  const withdrawWallet = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { circleWalletId: true, maxTxSizeUsd: true, dailyLimitUsd: true, network: true },
  });
  if (!withdrawWallet?.circleWalletId) {
    res.status(400).json({ error: 'Agent wallet not configured' });
    return;
  }

  const balance = await getAgentBalance(withdrawWallet.circleWalletId);
  if (sym === 'USDC') {
    const available = parseFloat(balance.usdc);
    if (amount > available) {
      res.status(400).json({ error: `Insufficient balance. Available: ${available} USDC` }); return;
    }
  } else if (sym === 'EURC') {
    const available = parseFloat(balance.eurc);
    if (amount > available) {
      res.status(400).json({ error: `Insufficient balance. Available: ${available} EURC` }); return;
    }
  }

  let withdrawUsd = 0;
  if (sym === 'USDC') {
    withdrawUsd = amount;
  } else if (sym === 'EURC') {
    const eurcUsd = await getCurrentFxRate('EURC', 'USDC');
    withdrawUsd = eurcUsd != null ? amount * eurcUsd : 0;
  }
  if (withdrawUsd <= 0) {
    res.status(400).json({ error: 'Could not determine USD value of withdrawal. Cannot verify limits. Try again.' });
    return;
  }

  if (withdrawUsd > withdrawWallet.maxTxSizeUsd) {
    res.status(400).json({ error: `Withdrawal value ~$${withdrawUsd.toFixed(2)} exceeds your $${withdrawWallet.maxTxSizeUsd} per-transaction limit. Adjust in Settings.` });
    return;
  }

  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const todayTxs = await prisma.agentTransaction.findMany({
    where: { userId: req.userId!, createdAt: { gte: todayStart }, status: 'SUCCESS' },
    select: { amountUsd: true },
  });
  const dailyTotal = todayTxs.reduce((sum, tx) => sum + (tx.amountUsd ?? 0), 0);
  if (dailyTotal + withdrawUsd > withdrawWallet.dailyLimitUsd) {
    res.status(400).json({ error: `Daily limit reached. Today: $${dailyTotal.toFixed(2)} + this withdrawal ~$${withdrawUsd.toFixed(2)} exceeds your $${withdrawWallet.dailyLimitUsd} daily limit. Adjust in Settings.` });
    return;
  }

  const destCheck = await validateWithdrawDestination(toAddress, sym);
  if (!destCheck.valid || destCheck.blacklisted) {
    await logAudit({ userId: req.userId!, actor: req.userId!, action: 'WITHDRAW_DEST_REJECTED', detail: { toAddress, token: sym, valid: destCheck.valid, blacklisted: destCheck.blacklisted } });
    res.status(403).json({ error: destCheck.reason ?? `Destination ${toAddress} rejected`, decision: 'BLOCK', destinationCheck: destCheck });
    return;
  }

  const screen = await screenAddress(toAddress);
  if (screen.decision === 'BLOCK') {
    await logAudit({ userId: req.userId!, actor: req.userId!, action: 'WITHDRAW_SCREENED_BLOCK', detail: { toAddress, flags: screen.flags, source: screen.source } });
    res.status(403).json({ error: `Destination ${toAddress} blocked by compliance screening (${screen.flags.join(', ')})`, decision: 'BLOCK', screening: screen });
    return;
  }

  const guard = await evaluateAction(req.userId!, { action: 'WITHDRAW', amountUsd: withdrawUsd, token: sym, destination: toAddress });
  if (guard.result.decision === 'DENY') {
    await logAudit({ userId: req.userId!, actor: req.userId!, action: 'WITHDRAW_BLOCKED', detail: { token: sym, amount, toAddress, reasons: guard.result.reasons } });
    res.status(403).json({ error: `Guardian policy blocked this withdrawal: ${guard.result.reasons.join('; ')}`, decision: 'DENY', reasons: guard.result.reasons });
    return;
  }
  if (guard.result.decision === 'REQUIRE_APPROVAL') {
    await logAudit({ userId: req.userId!, actor: req.userId!, action: 'WITHDRAW_NEEDS_APPROVAL', detail: { token: sym, amount, toAddress, reasons: guard.result.reasons } });
    res.status(403).json({ error: 'This withdrawal exceeds your approval threshold - submit it to your organization approval queue.', decision: 'REQUIRE_APPROVAL', reasons: guard.result.reasons });
    return;
  }

  try {
    const result = await withdrawFromAgentWallet(
      withdrawWallet.circleWalletId,
      sym,
      amount,
      toAddress,
      feeLevel,
    );

    await prisma.agentTransaction.create({
      data: {
        userId: req.userId!,
        type: 'WITHDRAW',
        tokenIn: sym,
        tokenOut: sym,
        amount: amount.toString(),
        amountUsd: withdrawUsd,
        txHash: result.txHash ?? null,
        toAddress,
        status: 'SUCCESS',
        network: withdrawWallet.network,
      },
    }).catch((err) => { logger.error('audit', 'Failed to log transaction', err); });

    await logAudit({ userId: req.userId!, actor: req.userId!, action: 'WITHDRAW_EXECUTED', detail: { token: sym, amount, toAddress, txHash: result.txHash } });

    res.json({
      success: true,
      txHash: result.txHash || null,
      txId: result.txId,
      pending: result.pending,
      explorerUrl: result.txHash ? explorerTxUrl(result.txHash) : null,
      token: result.token,
      amount: result.amount,
      toAddress: result.toAddress,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Withdraw failed';
    logger.error('agentWallet', `Withdraw failed: ${msg}`);
    await prisma.agentTransaction.create({
      data: {
        userId: req.userId!,
        type: 'WITHDRAW',
        tokenIn: sym,
        tokenOut: sym,
        amount: amount.toString(),
        amountUsd: 0,
        toAddress,
        status: 'FAILED',
        network: withdrawWallet.network,
      },
    }).catch((err) => { logger.error('audit', 'Failed to log transaction', err); });
    logger.error('withdraw', 'Withdrawal failed', err);
    res.status(500).json({ error: 'Withdrawal failed. Please try again.' });
  }
});

agentWalletRouter.delete('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.agentWallet.findUnique({ where: { userId: req.userId! }, select: { id: true } });
  if (!existing) { res.status(404).json({ error: 'No agent wallet found' }); return; }
  await prisma.agentWallet.delete({ where: { userId: req.userId! } });
  await logAudit({ userId: req.userId!, actor: req.userId!, action: 'AGENT_WALLET_RESET', detail: {} });
  res.json({ ok: true });
});
