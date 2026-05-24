import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { createPublicClient, http } from 'viem';
import type { Address } from 'viem';
import { ARC_EXPLORER } from '../lib/chains';
import { logger } from '../lib/logger';

const CIRCLE_API_KEY       = process.env.CIRCLE_API_KEY || '';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';
export const CIRCLE_WALLET_SET_ID = process.env.CIRCLE_WALLET_SET_ID || '';
export const ARC_NETWORK = (process.env.ARC_NETWORK || 'arc-testnet') as 'arc-testnet' | 'arc-mainnet';
const ARC_RPC = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network/';
const ARC_BLOCKCHAIN = 'ARC-TESTNET' as const;

export type WithdrawFeeLevel = 'LOW' | 'MEDIUM' | 'HIGH';

const FIATTOKEN_BLACKLIST_ABI = [
  {
    type: 'function',
    name: 'isBlacklisted',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export function isCircleConfigured(): boolean {
  return !!(CIRCLE_API_KEY && CIRCLE_ENTITY_SECRET && CIRCLE_WALLET_SET_ID);
}

function getClient() {
  return initiateDeveloperControlledWalletsClient({
    apiKey: CIRCLE_API_KEY,
    entitySecret: CIRCLE_ENTITY_SECRET,
  });
}

async function waitForTxHash(client: ReturnType<typeof getClient>, txId: string, timeoutMs = 45_000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await client.getTransaction({ id: txId });
    const tx = r.data?.transaction;
    const state = tx?.state ?? 'UNKNOWN';
    if (tx?.txHash) return tx.txHash;
    if (state === 'FAILED' || state === 'CANCELLED' || state === 'DENIED') {
      throw new Error(`Transaction ${txId} entered terminal state ${state}`);
    }
    await new Promise((res) => setTimeout(res, 2_500));
  }
  return null;
}

export async function createAgentWallet(
  walletAddress: string,
): Promise<{ address: string; walletId: string; walletSetId: string }> {
  const client = getClient();

  const result = await client.createWallets({
    walletSetId: CIRCLE_WALLET_SET_ID,
    blockchains: [ARC_BLOCKCHAIN],
    count: 1,
    accountType: process.env.WALLET_ACCOUNT_TYPE === 'SCA' ? 'SCA' : 'EOA',
    metadata: [{ name: `ga-${walletAddress.toLowerCase().slice(2, 12)}`, refId: walletAddress.toLowerCase() }],
  });

  const wallet = result.data?.wallets?.[0];
  if (!wallet) throw new Error('Circle wallet creation failed - no wallet returned');

  return {
    address: wallet.address,
    walletId: wallet.id,
    walletSetId: CIRCLE_WALLET_SET_ID,
  };
}

export interface AgentBalance {
  usdc: string;
  eurc: string;
  usyc: string;
  cirbtc: string;
}

export async function getAgentBalance(walletId: string): Promise<AgentBalance> {
  const client = getClient();
  try {
    const result = await client.getWalletTokenBalance({ id: walletId });
    const balances = result.data?.tokenBalances ?? [];

    const bySymbol = (sym: string) => balances.find((b: any) => b.token?.symbol?.toUpperCase() === sym);

    const fmt = (b: any, dp = 2) => {
      if (!b) return dp === 2 ? '0.00' : '0';
      return parseFloat(b.amount ?? '0').toFixed(dp);
    };

    return {
      usdc: fmt(bySymbol('USDC')),
      eurc: fmt(bySymbol('EURC')),
      usyc: fmt(bySymbol('USYC')),
      cirbtc: fmt(bySymbol('CIRBTC'), 8),
    };
  } catch (err) {
    logger.warn('arckit', 'Failed to fetch Circle wallet balances', err);
    return { usdc: '0.00', eurc: '0.00', usyc: '0.00', cirbtc: '0' };
  }
}

export interface WalletBalanceLine {
  symbol: string | null;
  amount: string;
  decimals: number | null;
  isNative: boolean;
  tokenAddress: string | null;
}

export interface WalletWithBalances {
  walletId: string;
  address: string;
  refId: string | null;
  state: string | null;
  balances: WalletBalanceLine[];
}

interface RawTokenBalance {
  amount?: string;
  token?: { symbol?: string; decimals?: number; isNative?: boolean; tokenAddress?: string };
}

interface RawWalletWithBalances {
  id?: string;
  address?: string;
  refId?: string;
  state?: string;
  tokenBalances?: RawTokenBalance[];
}

export async function listWalletSetBalances(): Promise<WalletWithBalances[]> {
  if (!CIRCLE_WALLET_SET_ID) throw new Error('CIRCLE_WALLET_SET_ID is not configured');
  const client = getClient();
  const out: WalletWithBalances[] = [];
  let pageAfter: string | undefined;

  for (let page = 0; page < 20; page++) {
    const r = await client.getWalletsWithBalances({
      blockchain: ARC_BLOCKCHAIN,
      walletSetId: CIRCLE_WALLET_SET_ID,
      pageSize: 50,
      ...(pageAfter ? { pageAfter } : {}),
    });

    const wallets = ((r.data?.wallets ?? []) as unknown[]) as RawWalletWithBalances[];
    if (wallets.length === 0) break;

    for (const w of wallets) {
      if (!w.id || !w.address) continue;
      const balances: WalletBalanceLine[] = (w.tokenBalances ?? []).map((b) => ({
        symbol: b.token?.symbol ?? null,
        amount: b.amount ?? '0',
        decimals: b.token?.decimals ?? null,
        isNative: b.token?.isNative ?? false,
        tokenAddress: b.token?.tokenAddress ?? null,
      }));
      out.push({ walletId: w.id, address: w.address, refId: w.refId ?? null, state: w.state ?? null, balances });
    }

    if (wallets.length < 50) break;
    pageAfter = wallets[wallets.length - 1].id;
  }

  return out;
}

export interface OnChainTx {
  id: string;
  type: string;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  amountUsd: number | null;
  txHash: string | null;
  toAddress: string | null;
  fromAddress: string | null;
  status: string;
  network: string;
  createdAt: string;
}

export async function listAgentTransactions(walletId: string): Promise<OnChainTx[]> {
  const client = getClient();
  const symById = new Map<string, string>();
  try {
    const bal = await client.getWalletTokenBalance({ id: walletId });
    for (const b of bal.data?.tokenBalances ?? []) {
      if (b.token?.id) symById.set(b.token.id, b.token.symbol ?? '?');
    }
  } catch { /* symbol map best-effort */ }

  const r = await client.listTransactions({ walletIds: [walletId], pageSize: 50 });
  const txs = r.data?.transactions ?? [];
  return txs.map((t) => {
    const incoming = t.transactionType === 'INBOUND';
    const sym = (t.tokenId && symById.get(t.tokenId)) || 'USDC';
    const amountInUSD = (t as { amountInUSD?: string }).amountInUSD;
    const operation = (t as { operation?: string }).operation;
    return {
      id: `circle-${t.id}`,
      type: incoming ? 'DEPOSIT' : t.transactionType === 'OUTBOUND' ? 'SEND' : (operation || 'TX'),
      tokenIn: sym,
      tokenOut: sym,
      amount: t.amounts?.[0] ?? '0',
      amountUsd: amountInUSD ? parseFloat(amountInUSD) : null,
      txHash: t.txHash ?? null,
      toAddress: incoming ? null : t.destinationAddress ?? null,
      fromAddress: incoming ? t.sourceAddress ?? null : null,
      status: t.state === 'COMPLETE' || t.state === 'CONFIRMED' ? 'SUCCESS' : (t.state ?? 'PENDING'),
      network: ARC_NETWORK,
      createdAt: t.createDate ?? new Date().toISOString(),
    };
  });
}

export interface FaucetTokens {
  usdc?: boolean;
  eurc?: boolean;
  native?: boolean;
}

export interface FaucetResult {
  status: 'requested';
  address: string;
  tokens: string[];
}

export async function requestFaucet(walletId: string, tokens: FaucetTokens = { usdc: true }): Promise<FaucetResult> {
  const client = getClient();

  const walletResult = await client.getWallet({ id: walletId });
  const address = walletResult.data?.wallet?.address;
  if (!address) throw new Error('Cannot request faucet - wallet address not found');

  const usdc = tokens.usdc ?? false;
  const eurc = tokens.eurc ?? false;
  const native = tokens.native ?? false;
  if (!usdc && !eurc && !native) throw new Error('Faucet request must include at least one token');

  await client.requestTestnetTokens({
    address,
    blockchain: ARC_BLOCKCHAIN,
    usdc,
    eurc,
    native,
  });

  const requested = [usdc && 'USDC', eurc && 'EURC', native && 'NATIVE'].filter(Boolean) as string[];
  return { status: 'requested', address, tokens: requested };
}

export interface TokenInfo {
  id: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  isNative: boolean;
  tokenAddress: string | null;
  blockchain: string | null;
}

export async function getTokenInfo(tokenId: string): Promise<TokenInfo | null> {
  const client = getClient();
  const r = await client.getToken({ id: tokenId });
  const t = r.data?.token;
  if (!t) return null;
  return {
    id: t.id,
    symbol: t.symbol ?? null,
    name: t.name ?? null,
    decimals: t.decimals ?? null,
    isNative: t.isNative,
    tokenAddress: t.tokenAddress ?? null,
    blockchain: t.blockchain ?? null,
  };
}

export interface SignedMessage {
  message: string;
  signature: string;
}

export async function signWalletMessage(walletId: string, message: string): Promise<SignedMessage> {
  const client = getClient();
  const r = await client.signMessage({ walletId, message });
  const signature = r.data?.signature;
  if (!signature) throw new Error('Signing failed - no signature returned');
  return { message, signature };
}

export interface WithdrawResult {
  txHash: string;
  txId: string;
  pending: boolean;
  token: string;
  amount: string;
  toAddress: string;
  network: string;
}

export async function withdrawFromAgentWallet(
  walletId: string,
  token: string,
  amount: number,
  toAddress: string,
  feeLevel: WithdrawFeeLevel = 'MEDIUM',
): Promise<WithdrawResult> {
  const client = getClient();

  const balResult = await client.getWalletTokenBalance({ id: walletId });
  const tokenBalances = balResult.data?.tokenBalances ?? [];
  const match = tokenBalances.find((b) => b.token?.symbol?.toUpperCase() === token.toUpperCase());
  const tokenId = match?.token?.id;
  if (!tokenId) throw new Error(`Token ${token} not held by agent wallet`);

  const result = await client.createTransaction({
    walletId,
    tokenId,
    destinationAddress: toAddress,
    amount: [amount.toString()],
    fee: {
      type: 'level',
      config: { feeLevel },
    },
  });

  const txId = result.data?.id;
  if (!txId) throw new Error('Withdrawal failed to submit');

  const onchainHash = await waitForTxHash(client, txId);

  return {
    txHash: onchainHash ?? '',
    txId,
    pending: !onchainHash,
    token: token.toUpperCase(),
    amount: `${amount} ${token.toUpperCase()}`,
    toAddress,
    network: ARC_NETWORK,
  };
}

const TERMINAL_TX_STATES = new Set(['COMPLETE', 'CONFIRMED', 'FAILED', 'CANCELLED', 'DENIED']);

export interface PendingTxInfo {
  id: string;
  walletId: string | null;
  state: string;
  txHash: string | null;
  terminal: boolean;
}

export async function getTransactionInfo(txId: string): Promise<PendingTxInfo | null> {
  const client = getClient();
  const r = await client.getTransaction({ id: txId });
  const tx = r.data?.transaction;
  if (!tx) return null;
  const state = (tx.state ?? 'UNKNOWN').toUpperCase();
  return {
    id: tx.id,
    walletId: tx.walletId ?? null,
    state,
    txHash: tx.txHash ?? null,
    terminal: TERMINAL_TX_STATES.has(state),
  };
}

export interface TxActionResult {
  id: string;
  action: 'ACCELERATE' | 'CANCEL';
}

export async function accelerateAgentTransaction(txId: string): Promise<TxActionResult> {
  const client = getClient();
  const r = await client.accelerateTransaction({ id: txId });
  logger.info('arckit', `Accelerated transaction ${txId}`);
  return { id: r.data?.id ?? txId, action: 'ACCELERATE' };
}

export async function cancelAgentTransaction(txId: string): Promise<TxActionResult> {
  const client = getClient();
  const r = await client.cancelTransaction({ id: txId });
  logger.info('arckit', `Cancelled transaction ${txId}`);
  return { id: r.data?.id ?? txId, action: 'CANCEL' };
}

function publicClient() {
  return createPublicClient({ transport: http(ARC_RPC) });
}

export interface DestinationCheck {
  valid: boolean;
  blacklisted: boolean;
  reason?: string;
}

export async function validateWithdrawDestination(toAddress: string, token: string): Promise<DestinationCheck> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
    return { valid: false, blacklisted: false, reason: 'Invalid destination address format' };
  }

  let valid = true;
  try {
    const r = await getClient().validateAddress({ address: toAddress, blockchain: ARC_BLOCKCHAIN });
    valid = (r.data as { isValid?: boolean })?.isValid !== false;
  } catch (err) {
    logger.warn('withdraw', `validateAddress inconclusive for ${toAddress}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!valid) {
    return { valid: false, blacklisted: false, reason: `Circle reports ${toAddress} is not a valid ${ARC_BLOCKCHAIN} address` };
  }

  let tokenAddress: string;
  try {
    tokenAddress = tokenSymbolToAddress(token);
  } catch {
    return { valid: true, blacklisted: false };
  }

  let blacklisted = false;
  try {
    blacklisted = (await publicClient().readContract({
      address: tokenAddress as Address,
      abi: FIATTOKEN_BLACKLIST_ABI,
      functionName: 'isBlacklisted',
      args: [toAddress as Address],
    })) as boolean;
  } catch (err) {
    logger.warn('withdraw', `${token} blacklist check inconclusive for ${toAddress}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (blacklisted) {
    return { valid: true, blacklisted: true, reason: `Destination ${toAddress} is blacklisted on the ${token} token contract; a transfer to it would revert and could lock funds` };
  }

  return { valid: true, blacklisted: false };
}

export interface WithdrawFeeOption {
  feeLevel: WithdrawFeeLevel;
  networkFee: string | null;
  maxFee: string | null;
  priorityFee: string | null;
  gasLimit: string | null;
  baseFee: string | null;
}

export interface WithdrawFeeEstimate {
  token: string;
  amount: string;
  gasToken: string;
  options: WithdrawFeeOption[];
}

export async function estimateWithdrawFee(
  walletId: string,
  token: string,
  amount: number,
  toAddress: string,
): Promise<WithdrawFeeEstimate> {
  const tokenAddress = tokenSymbolToAddress(token);
  const r = await getClient().estimateTransferFee({
    walletId,
    destinationAddress: toAddress,
    amount: [amount.toString()],
    tokenAddress,
    blockchain: ARC_BLOCKCHAIN,
  });

  const data = (r.data ?? {}) as Record<string, { networkFee?: string; maxFee?: string; priorityFee?: string; gasLimit?: string; baseFee?: string } | undefined>;
  const levels: WithdrawFeeLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
  const options: WithdrawFeeOption[] = levels.map((lvl) => {
    const f = data[lvl.toLowerCase()] ?? {};
    return {
      feeLevel: lvl,
      networkFee: f.networkFee ?? null,
      maxFee: f.maxFee ?? null,
      priorityFee: f.priorityFee ?? null,
      gasLimit: f.gasLimit ?? null,
      baseFee: f.baseFee ?? null,
    };
  });

  return { token: token.toUpperCase(), amount: amount.toString(), gasToken: 'USDC', options };
}

function tokenSymbolToAddress(symbol: string): string {
  const sym = symbol.toUpperCase();
  const map: Record<string, string> = {
    USDC: '0x3600000000000000000000000000000000000000',
    EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    USYC: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C',
  };
  if (!map[sym]) throw new Error(`Unsupported token on Arc: ${symbol}`);
  return map[sym];
}

export function explorerTxUrl(txHash: string): string {
  return `${ARC_EXPLORER}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${ARC_EXPLORER}/address/${address}`;
}

export interface TokenVerification {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  holders: number;
  marketCap: number | null;
  price: number;
  liquidity: number;
  volume24h: number;
  icon: string;
  isVerified: boolean;
  warnings: string[];
}

export async function verifyToken(_symbol: string): Promise<{ candidates: TokenVerification[]; best: TokenVerification | null }> {
  return { candidates: [], best: null };
}

export async function resolveToken(_symbol: string): Promise<{ address: `0x${string}`; decimals: number } | null> {
  return null;
}

export async function getUsdValue(
  _symbol: string,
  _amount: number,
  _network?: string,
  _walletAddress?: string,
): Promise<number> {
  throw new Error('Arc price lookup not configured - Phase 3');
}

export interface SwapQuoteResult {
  supported: boolean;
  error?: string;
  toAmountEstimate?: string;
  rate?: string;
  minOutput?: string;
  fee?: string;
  priceImpact?: string;
}

export async function getSwapQuote(
  _fromSymbol: string,
  _toSymbol: string,
  _amount: number,
  _network?: string,
  _walletAddress?: string,
  _slippage?: number,
): Promise<SwapQuoteResult> {
  return { supported: false, error: 'Arc swap not configured - Phase 3' };
}

export interface SwapResult {
  txHash: string;
  fromAmount: string;
  toAmount: string;
}

export async function executeGenericSwap(
  _walletAddress: string,
  _fromSymbol: string,
  _toSymbol: string,
  _amount: number,
  _network?: string,
  _slippage?: number,
  _addresses?: { toAddress?: string; toDecimals?: number; fromAddress?: string; fromDecimals?: number },
): Promise<SwapResult> {
  throw new Error('Arc swap not configured - Phase 3');
}
