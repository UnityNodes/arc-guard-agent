import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { createPublicClient, decodeEventLog, http, keccak256, toHex, getAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { arcTestnet } from '../lib/chains';
import { logger } from '../lib/logger';

const CIRCLE_API_KEY       = process.env.CIRCLE_API_KEY || '';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';
const ARC_RPC              = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network/';

export const IDENTITY_REGISTRY   = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as Address;
export const REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713' as Address;

export const REPUTATION_ABI = [
  {
    type: 'function', name: 'giveFeedback', stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId',      type: 'uint256' },
      { name: 'score',        type: 'int128'  },
      { name: 'feedbackType', type: 'uint8'   },
      { name: 'tag',          type: 'string'  },
      { name: 'metadataURI',  type: 'string'  },
      { name: 'evidenceURI',  type: 'string'  },
      { name: 'comment',      type: 'string'  },
      { name: 'feedbackHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'event', name: 'FeedbackGiven', anonymous: false,
    inputs: [
      { indexed: true,  name: 'agentId',      type: 'uint256' },
      { indexed: true,  name: 'validator',    type: 'address' },
      { indexed: false, name: 'score',        type: 'int128'  },
      { indexed: false, name: 'feedbackType', type: 'uint8'   },
      { indexed: false, name: 'tag',          type: 'string'  },
      { indexed: false, name: 'metadataURI',  type: 'string'  },
      { indexed: false, name: 'evidenceURI',  type: 'string'  },
      { indexed: false, name: 'comment',      type: 'string'  },
      { indexed: false, name: 'feedbackHash', type: 'bytes32' },
    ],
  },
] as const;

const IDENTITY_OWNER_ABI = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
] as const;

function getClient() {
  return initiateDeveloperControlledWalletsClient({ apiKey: CIRCLE_API_KEY, entitySecret: CIRCLE_ENTITY_SECRET });
}

function publicClient() {
  return createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) });
}

async function waitTxHash(client: ReturnType<typeof getClient>, txId: string, timeoutMs = 90_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await client.getTransaction({ id: txId });
    const tx = r.data?.transaction;
    const state = tx?.state ?? 'UNKNOWN';
    if (tx?.txHash && (state === 'CONFIRMED' || state === 'COMPLETE')) return tx.txHash;
    if (state === 'FAILED' || state === 'CANCELLED' || state === 'DENIED') {
      throw new Error(`Transaction ${txId} entered terminal state ${state}`);
    }
    await new Promise((res) => setTimeout(res, 2_500));
  }
  throw new Error(`Transaction ${txId} did not confirm within ${timeoutMs}ms`);
}

export async function ownerOfAgent(agentId: string): Promise<string | null> {
  try {
    const owner = await publicClient().readContract({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_OWNER_ABI,
      functionName: 'ownerOf',
      args: [BigInt(agentId)],
    });
    return owner as string;
  } catch (err) {
    logger.warn('reputation', `ownerOf(${agentId}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface GiveFeedbackInput {
  walletId: string;
  walletAddress: string;
  targetAgentId: string;
  score: number;
  feedbackType?: number;
  tag: string;
  metadataURI?: string;
  evidenceURI?: string;
  comment?: string;
  feedbackHash?: string;
}

export interface FeedbackResult {
  txHash: string;
  agentId: string;
  validator: string;
  feedbackHash: string;
  score: number;
  tag: string;
}

export function bytes32FromText(text: string): Hex {
  return keccak256(toHex(text));
}

export async function giveAgentFeedback(input: GiveFeedbackInput): Promise<FeedbackResult> {
  const { walletId, walletAddress, targetAgentId, score, tag } = input;
  if (!/^\d+$/.test(targetAgentId)) throw new Error('targetAgentId must be a positive integer string');
  if (!Number.isInteger(score) || score < -100 || score > 100) {
    throw new Error('score must be an integer in [-100, 100]');
  }
  if (!tag || tag.length === 0 || tag.length > 80) throw new Error('tag must be 1-80 characters');
  const feedbackType = input.feedbackType ?? 0;
  if (!Number.isInteger(feedbackType) || feedbackType < 0 || feedbackType > 255) {
    throw new Error('feedbackType must be a uint8 (0-255)');
  }
  const metadataURI = input.metadataURI ?? '';
  const evidenceURI = input.evidenceURI ?? '';
  const comment     = input.comment ?? '';
  if (metadataURI.length > 500 || evidenceURI.length > 500 || comment.length > 1000) {
    throw new Error('metadataURI/evidenceURI must be ≤500 chars, comment ≤1000');
  }
  const feedbackHash = input.feedbackHash && /^0x[a-fA-F0-9]{64}$/.test(input.feedbackHash)
    ? input.feedbackHash
    : bytes32FromText(tag);

  const owner = await ownerOfAgent(targetAgentId);
  if (owner && owner.toLowerCase() === walletAddress.toLowerCase()) {
    throw new Error('ERC-8004 forbids self-dealing: agent owners cannot record reputation for their own agents');
  }

  const client = getClient();
  const r = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: REPUTATION_REGISTRY,
    abiFunctionSignature: 'giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)',
    abiParameters: [
      targetAgentId,
      score.toString(),
      feedbackType.toString(),
      tag,
      metadataURI,
      evidenceURI,
      comment,
      feedbackHash,
    ],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const txId = (r.data as { id?: string })?.id;
  if (!txId) throw new Error('giveFeedback failed to submit');
  const txHash = await waitTxHash(client, txId);

  return {
    txHash,
    agentId: targetAgentId,
    validator: walletAddress,
    feedbackHash,
    score,
    tag,
  };
}

export interface FeedbackRecord {
  txHash: string;
  blockNumber: string;
  agentId: string;
  validator: string;
  score: number;
  feedbackType: number;
  tag: string;
  metadataURI: string;
  evidenceURI: string;
  comment: string;
  feedbackHash: string;
  decoded: boolean;
}

const MAX_HISTORY_BLOCKS = 200_000n;
const RPC_LOG_RANGE = 10_000n; // Arc RPC limit on eth_getLogs per call

export async function listAgentFeedback(agentId: string, maxResults = 50): Promise<FeedbackRecord[]> {
  if (!/^\d+$/.test(agentId)) throw new Error('agentId must be a positive integer string');
  const pc = publicClient();
  const latest = await pc.getBlockNumber();
  const fromBlock = latest > MAX_HISTORY_BLOCKS ? latest - MAX_HISTORY_BLOCKS : 0n;

  // Page newest→oldest in RPC_LOG_RANGE chunks; stop once we have enough.
  const logs: Awaited<ReturnType<typeof pc.getLogs>> = [];
  let cursor = latest;
  while (cursor >= fromBlock) {
    const chunkFrom = cursor > RPC_LOG_RANGE ? cursor - RPC_LOG_RANGE + 1n : 0n;
    const from = chunkFrom < fromBlock ? fromBlock : chunkFrom;
    const chunk = await pc.getLogs({
      address: REPUTATION_REGISTRY,
      fromBlock: from,
      toBlock: cursor,
    });
    logs.push(...chunk);
    if (from === 0n || from === fromBlock) break;
    cursor = from - 1n;
    if (logs.length >= maxResults * 4) break;
  }

  const out: FeedbackRecord[] = [];
  const agentIdBig = BigInt(agentId);
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: REPUTATION_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName !== 'FeedbackGiven') continue;
      const args = decoded.args as {
        agentId: bigint; validator: Address; score: bigint; feedbackType: number;
        tag: string; metadataURI: string; evidenceURI: string; comment: string; feedbackHash: Hex;
      };
      if (args.agentId !== agentIdBig) continue;
      out.push({
        txHash: log.transactionHash ?? '',
        blockNumber: log.blockNumber?.toString() ?? '0',
        agentId: args.agentId.toString(),
        validator: getAddress(args.validator),
        score: Number(args.score),
        feedbackType: Number(args.feedbackType),
        tag: args.tag,
        metadataURI: args.metadataURI,
        evidenceURI: args.evidenceURI,
        comment: args.comment,
        feedbackHash: args.feedbackHash,
        decoded: true,
      });
    } catch {
      /* event signature mismatch, skip */
    }
  }
  out.sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)));
  return out.slice(0, maxResults);
}

export interface ReputationSummary {
  agentId: string;
  count: number;
  averageScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  lastFeedbackAt: string | null;
  tagCounts: Record<string, number>;
}

export async function summarizeAgentReputation(agentId: string): Promise<ReputationSummary> {
  const records = await listAgentFeedback(agentId, 200);
  if (records.length === 0) {
    return { agentId, count: 0, averageScore: null, minScore: null, maxScore: null, lastFeedbackAt: null, tagCounts: {} };
  }
  let sum = 0;
  let min = records[0].score;
  let max = records[0].score;
  const tagCounts: Record<string, number> = {};
  for (const r of records) {
    sum += r.score;
    if (r.score < min) min = r.score;
    if (r.score > max) max = r.score;
    if (r.tag) tagCounts[r.tag] = (tagCounts[r.tag] ?? 0) + 1;
  }
  return {
    agentId,
    count: records.length,
    averageScore: sum / records.length,
    minScore: min,
    maxScore: max,
    lastFeedbackAt: records[0]?.blockNumber ?? null,
    tagCounts,
  };
}
