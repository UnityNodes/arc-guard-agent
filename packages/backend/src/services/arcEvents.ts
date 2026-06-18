import { createPublicClient, http, decodeEventLog, parseAbiItem, toEventSelector, getAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { arcTestnet } from '../lib/chains';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';

const ARC_RPC = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network/';

export const USDC_ADDRESS         = '0x3600000000000000000000000000000000000000' as Address;
export const EURC_ADDRESS         = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as Address;
export const MEMO_CONTRACT        = '0x5294E9927c3306DcBaDb03fe70b92e01cCede505' as Address;
export const MULTICALL3FROM       = '0x522fAf9A91c41c443c66765030741e4AaCe147D0' as Address;

export const ARC_FORWARDING_CONTRACTS: Address[] = [MEMO_CONTRACT, MULTICALL3FROM];

export function isArcForwardingContract(address: string): boolean {
  const lower = address.toLowerCase();
  return ARC_FORWARDING_CONTRACTS.some((a) => a.toLowerCase() === lower);
}

const TRANSFER_EVENT      = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const BLOCKLISTED_EVENT   = parseAbiItem('event Blocklisted(address indexed account)');
const UNBLOCKLISTED_EVENT = parseAbiItem('event UnBlocklisted(address indexed account)');
const MEMO_EVENT          = parseAbiItem('event Memo(address indexed sender, address indexed target, bytes32 callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)');

export const TRANSFER_TOPIC      = toEventSelector(TRANSFER_EVENT);
export const BLOCKLISTED_TOPIC   = toEventSelector(BLOCKLISTED_EVENT);
export const UNBLOCKLISTED_TOPIC = toEventSelector(UNBLOCKLISTED_EVENT);
export const MEMO_TOPIC          = toEventSelector(MEMO_EVENT);

export const TRANSFER_ABI  = [TRANSFER_EVENT] as const;
export const BLOCKLIST_ABI = [BLOCKLISTED_EVENT, UNBLOCKLISTED_EVENT] as const;
export const MEMO_ABI      = [MEMO_EVENT] as const;

const DEFAULT_WINDOW_BLOCKS = 9_000n;
const MAX_RESULTS = 200;

function publicClient() {
  return createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) });
}

async function resolveRange(fromBlock?: bigint, toBlock?: bigint): Promise<{ from: bigint; to: bigint }> {
  const pc = publicClient();
  const latest = await pc.getBlockNumber();
  const to = toBlock ?? latest;
  const from = fromBlock ?? (latest > DEFAULT_WINDOW_BLOCKS ? latest - DEFAULT_WINDOW_BLOCKS : 0n);
  return { from, to };
}

function checksum(addr: string): Address {
  return getAddress(addr) as Address;
}

function forwarderTag(addr: string): 'memo' | 'multicall3from' | null {
  const lower = addr.toLowerCase();
  if (lower === MEMO_CONTRACT.toLowerCase()) return 'memo';
  if (lower === MULTICALL3FROM.toLowerCase()) return 'multicall3from';
  return null;
}

export interface TransferEvent {
  token: 'USDC' | 'EURC';
  blockNumber: string;
  logIndex: number;
  txHash: string;
  from: string;
  to: string;
  amountRaw: string;
  amountFormatted: string;
  fromForwarder: 'memo' | 'multicall3from' | null;
  toForwarder: 'memo' | 'multicall3from' | null;
}

function formatUnits(raw: bigint, decimals: number): string {
  const div = BigInt(10) ** BigInt(decimals);
  const whole = raw / div;
  const frac = raw % div;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

async function getTokenTransfers(
  token: 'USDC' | 'EURC',
  address: string,
  fromBlock?: bigint,
  toBlock?: bigint,
): Promise<TransferEvent[]> {
  const contract = token === 'USDC' ? USDC_ADDRESS : EURC_ADDRESS;
  const range = await resolveRange(fromBlock, toBlock);
  const pc = publicClient();
  const who = checksum(address);

  const [outgoing, incoming] = await Promise.all([
    pc.getLogs({
      address: contract,
      event: TRANSFER_EVENT,
      args: { from: who },
      fromBlock: range.from, toBlock: range.to,
    }),
    pc.getLogs({
      address: contract,
      event: TRANSFER_EVENT,
      args: { to: who },
      fromBlock: range.from, toBlock: range.to,
    }),
  ]);

  const merged = [...outgoing, ...incoming];
  const out: TransferEvent[] = [];
  const seen = new Set<string>();
  for (const log of merged) {
    const key = `${log.blockNumber}-${log.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const decoded = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName !== 'Transfer') continue;
      const args = decoded.args as { from: Address; to: Address; value: bigint };
      const fromAddr = getAddress(args.from);
      const toAddr = getAddress(args.to);
      out.push({
        token,
        blockNumber: log.blockNumber?.toString() ?? '0',
        logIndex: Number(log.logIndex ?? 0),
        txHash: log.transactionHash ?? '',
        from: fromAddr,
        to: toAddr,
        amountRaw: args.value.toString(),
        amountFormatted: formatUnits(args.value, 6),
        fromForwarder: forwarderTag(fromAddr),
        toForwarder: forwarderTag(toAddr),
      });
    } catch { /* skip non-matching */ }
  }
  out.sort((a, b) => {
    const bb = BigInt(b.blockNumber) - BigInt(a.blockNumber);
    if (bb !== 0n) return bb > 0n ? 1 : -1;
    return b.logIndex - a.logIndex;
  });
  return out.slice(0, MAX_RESULTS);
}

export interface MemoEvent {
  blockNumber: string;
  logIndex: number;
  txHash: string;
  sender: string;
  target: string;
  memoId: string;
  memoHex: string;
  memoText: string | null;
}

function tryDecodeUtf8(hex: string): string | null {
  try {
    const bytes = Buffer.from(hex.replace(/^0x/, ''), 'hex');
    const text = bytes.toString('utf-8');
    return /^[\x20-\x7E\n\r\t]+$/.test(text) ? text : null;
  } catch {
    return null;
  }
}

export async function getMemoEvents(
  address: string,
  fromBlock?: bigint,
  toBlock?: bigint,
): Promise<MemoEvent[]> {
  const range = await resolveRange(fromBlock, toBlock);
  const pc = publicClient();
  const who = checksum(address);

  const logs = await pc.getLogs({
    address: MEMO_CONTRACT,
    event: MEMO_EVENT,
    args: { sender: who },
    fromBlock: range.from, toBlock: range.to,
  }).catch(() => []);

  const out: MemoEvent[] = [];
  const seen = new Set<string>();
  for (const log of logs) {
    const key = `${log.blockNumber}-${log.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const decoded = decodeEventLog({ abi: MEMO_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName !== 'Memo') continue;
      const args = decoded.args as { sender: Address; target: Address; callDataHash: Hex; memoId: Hex; memo: Hex; memoIndex: bigint };
      out.push({
        blockNumber: log.blockNumber?.toString() ?? '0',
        logIndex: Number(log.logIndex ?? 0),
        txHash: log.transactionHash ?? '',
        sender: getAddress(args.sender),
        target: getAddress(args.target),
        memoId: args.memoId,
        memoHex: args.memo,
        memoText: tryDecodeUtf8(args.memo),
      });
    } catch { /* skip */ }
  }
  out.sort((a, b) => {
    const bb = BigInt(b.blockNumber) - BigInt(a.blockNumber);
    if (bb !== 0n) return bb > 0n ? 1 : -1;
    return b.logIndex - a.logIndex;
  });
  return out.slice(0, MAX_RESULTS);
}

export interface BlocklistEvent {
  blockNumber: string;
  logIndex: number;
  txHash: string;
  account: string;
  action: 'BLOCKED' | 'UNBLOCKED';
}

export async function getBlocklistEvents(
  fromBlock?: bigint,
  toBlock?: bigint,
): Promise<BlocklistEvent[]> {
  const range = await resolveRange(fromBlock, toBlock);
  const pc = publicClient();
  const logs = await pc.getLogs({
    address: USDC_ADDRESS,
    events: BLOCKLIST_ABI,
    fromBlock: range.from, toBlock: range.to,
  });
  const out: BlocklistEvent[] = [];
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: BLOCKLIST_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName !== 'Blocklisted' && decoded.eventName !== 'UnBlocklisted') continue;
      const args = decoded.args as { account: Address };
      out.push({
        blockNumber: log.blockNumber?.toString() ?? '0',
        logIndex: Number(log.logIndex ?? 0),
        txHash: log.transactionHash ?? '',
        account: getAddress(args.account),
        action: decoded.eventName === 'Blocklisted' ? 'BLOCKED' : 'UNBLOCKED',
      });
    } catch { /* skip */ }
  }
  out.sort((a, b) => {
    const bb = BigInt(b.blockNumber) - BigInt(a.blockNumber);
    if (bb !== 0n) return bb > 0n ? 1 : -1;
    return b.logIndex - a.logIndex;
  });
  return out.slice(0, MAX_RESULTS);
}

const BLOCKLIST_CACHE_KEY = 'arc:blocklist:state';
const BLOCKLIST_CACHE_TTL = 60 * 5;

export interface BlocklistState {
  blocked: string[];
  asOfBlock: string;
}

export async function getBlocklistState(): Promise<BlocklistState> {
  try {
    const cached = await redis.get(BLOCKLIST_CACHE_KEY);
    if (cached) return JSON.parse(cached) as BlocklistState;
  } catch (err) {
    logger.warn('events', `blocklist cache GET failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const events = await getBlocklistEvents();
  events.sort((a, b) => {
    const bb = BigInt(a.blockNumber) - BigInt(b.blockNumber);
    if (bb !== 0n) return bb > 0n ? 1 : -1;
    return a.logIndex - b.logIndex;
  });

  const set = new Set<string>();
  let asOf = '0';
  for (const e of events) {
    const lower = e.account.toLowerCase();
    if (e.action === 'BLOCKED') set.add(lower);
    else set.delete(lower);
    asOf = e.blockNumber;
  }
  const state: BlocklistState = { blocked: Array.from(set), asOfBlock: asOf };
  try {
    await redis.setex(BLOCKLIST_CACHE_KEY, BLOCKLIST_CACHE_TTL, JSON.stringify(state));
  } catch (err) {
    logger.warn('events', `blocklist cache SET failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return state;
}

export interface CombinedActivityItem {
  kind: 'TRANSFER' | 'MEMO';
  blockNumber: string;
  logIndex: number;
  txHash: string;
  data: TransferEvent | MemoEvent;
}

export interface CombinedActivity {
  address: string;
  items: CombinedActivityItem[];
  range: { fromBlock: string; toBlock: string };
}

export async function getCombinedActivity(
  address: string,
  fromBlock?: bigint,
  toBlock?: bigint,
): Promise<CombinedActivity> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error('Invalid address');
  const range = await resolveRange(fromBlock, toBlock);
  const [usdc, eurc, memos] = await Promise.all([
    getTokenTransfers('USDC', address, range.from, range.to),
    getTokenTransfers('EURC', address, range.from, range.to).catch(() => []),
    getMemoEvents(address, range.from, range.to).catch(() => []),
  ]);

  const items: CombinedActivityItem[] = [];
  for (const t of usdc) items.push({ kind: 'TRANSFER', blockNumber: t.blockNumber, logIndex: t.logIndex, txHash: t.txHash, data: t });
  for (const t of eurc) items.push({ kind: 'TRANSFER', blockNumber: t.blockNumber, logIndex: t.logIndex, txHash: t.txHash, data: t });
  for (const m of memos) items.push({ kind: 'MEMO',    blockNumber: m.blockNumber, logIndex: m.logIndex, txHash: m.txHash, data: m });

  items.sort((a, b) => {
    const bb = BigInt(b.blockNumber) - BigInt(a.blockNumber);
    if (bb !== 0n) return bb > 0n ? 1 : -1;
    return b.logIndex - a.logIndex;
  });
  return { address: getAddress(address), items: items.slice(0, MAX_RESULTS), range: { fromBlock: range.from.toString(), toBlock: range.to.toString() } };
}
