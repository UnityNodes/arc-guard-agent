import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { logger } from '../lib/logger';

const CIRCLE_API_KEY       = process.env.CIRCLE_API_KEY || '';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';

const USDC         = '0x3600000000000000000000000000000000000000';
const USYC         = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C';
const TELLER       = '0x9fdF14c5B14173D74C08Af27AebFf39240dC105A';
const ORACLE       = '0x52b56c7642E71dc54714d879127d97cd0B3D4581';
const ENTITLEMENTS = '0xcc205224862c7641930c87679e98999d23c26113';
const USYC_PRICE_API = 'https://usyc.dev.hashnote.com/api/price';
const DECIMALS = 6;

export function isUsycConfigured(): boolean {
  return !!(CIRCLE_API_KEY && CIRCLE_ENTITY_SECRET);
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

function toUnits(amount: string): string {
  const [whole, frac = ''] = amount.split('.');
  const fracPadded = (frac + '0'.repeat(DECIMALS)).slice(0, DECIMALS);
  return (BigInt(whole || '0') * 10n ** BigInt(DECIMALS) + BigInt(fracPadded || '0')).toString();
}

async function waitForTx(client: ReturnType<typeof getClient>, txId: string, timeoutMs = 90_000): Promise<string | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await client.getTransaction({ id: txId });
    const tx = r.data?.transaction;
    const state = tx?.state ?? 'UNKNOWN';
    if (state === 'CONFIRMED' || state === 'COMPLETE') return tx?.txHash;
    if (state === 'FAILED' || state === 'CANCELLED' || state === 'DENIED') {
      throw new Error(`Transaction ${txId} entered terminal state ${state}`);
    }
    await new Promise((res) => setTimeout(res, 2_500));
  }
  throw new Error(`Transaction ${txId} not confirmed within ${timeoutMs}ms`);
}

export interface UsycInfo {
  price: number;
  apy: number | null;
  token: string;
  underlying: string;
  permissioned: boolean;
  contracts: { usyc: string; teller: string; oracle: string; entitlements: string };
  compliance: string[];
}

export async function getUsycInfo(): Promise<UsycInfo> {
  const base = {
    token: 'USYC',
    underlying: 'US Treasuries (Hashnote Short Duration Yield)',
    permissioned: true,
    contracts: { usyc: USYC, teller: TELLER, oracle: ORACLE, entitlements: ENTITLEMENTS },
    compliance: [
      'On-chain OFAC sanctions screening on every transfer (Entitlements oracle)',
      'Permissioned allowlist - transfers from non-allowlisted wallets revert',
      'Issuer freeze control for regulatory compliance',
    ],
  };
  try {
    const r = await fetch(USYC_PRICE_API, { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return { price: 1, apy: null, ...base };
    const d = (await r.json()) as { data?: { price?: string; nextPrice?: string } };
    const price = parseFloat(d.data?.price ?? '1');
    const next = d.data?.nextPrice ? parseFloat(d.data.nextPrice) : null;
    let apy: number | null = null;
    if (next && price > 0) {
      const daily = next / price - 1;
      apy = Math.round(daily * 365 * 100 * 100) / 100;
    }
    return { price: isFinite(price) && price > 0 ? price : 1, apy, ...base };
  } catch {
    return { price: 1, apy: null, ...base };
  }
}

export interface UsycTxResult {
  txHash: string;
  from: string;
  to: string;
  amount: string;
}

export async function depositUSYC(walletId: string, receiver: string, amount: string): Promise<UsycTxResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(receiver)) throw new Error('Invalid receiver address');
  const client = getClient();
  const units = toUnits(amount);

  const approve = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: USDC,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [TELLER, units],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const approveId = approve.data?.id;
  if (!approveId) throw new Error('USYC approve failed to submit');
  await waitForTx(client, approveId);

  const dep = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: TELLER,
    abiFunctionSignature: 'deposit(uint256,address)',
    abiParameters: [units, receiver],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const depId = dep.data?.id;
  if (!depId) throw new Error('USYC deposit failed to submit');

  const onchainHash = await waitForTx(client, depId);
  logger.info('usyc', `USYC deposit confirmed ${amount} USDC tx ${onchainHash ?? depId}`);
  return { txHash: onchainHash ?? depId, from: 'USDC', to: 'USYC', amount };
}

export async function redeemUSYC(walletId: string, receiver: string, amount: string): Promise<UsycTxResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(receiver)) throw new Error('Invalid receiver address');
  const client = getClient();
  const units = toUnits(amount);
  const owner = await resolveAddress(walletId);

  const approve = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: USYC,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [TELLER, units],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const approveId = approve.data?.id;
  if (!approveId) throw new Error('USYC approve failed to submit');
  await waitForTx(client, approveId);

  const red = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: TELLER,
    abiFunctionSignature: 'redeem(uint256,address,address)',
    abiParameters: [units, receiver, owner],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const redId = red.data?.id;
  if (!redId) throw new Error('USYC redeem failed to submit');

  const onchainHash = await waitForTx(client, redId);
  logger.info('usyc', `USYC redeem confirmed ${amount} USYC tx ${onchainHash ?? redId}`);
  return { txHash: onchainHash ?? redId, from: 'USYC', to: 'USDC', amount };
}
