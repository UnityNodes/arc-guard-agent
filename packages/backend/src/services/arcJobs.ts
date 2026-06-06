import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { createPublicClient, http, decodeEventLog, keccak256, toHex } from 'viem';
import type { Address, Hex } from 'viem';
import { arcTestnet } from '../lib/chains';
import { logger } from '../lib/logger';

const CIRCLE_API_KEY       = process.env.CIRCLE_API_KEY || '';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';
const ARC_RPC              = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network/';

export const AGENTIC_COMMERCE_CONTRACT = '0x0747EEf0706327138c69792bF28Cd525089e4583' as Address;
export const USDC_ADDRESS              = '0x3600000000000000000000000000000000000000' as Address;
export const ZERO_ADDRESS              = '0x0000000000000000000000000000000000000000' as Address;

export const JOB_STATUS_NAMES = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'] as const;
export type JobStatusName = typeof JOB_STATUS_NAMES[number];

export const AGENTIC_COMMERCE_ABI = [
  {
    type: 'function', name: 'createJob', stateMutability: 'nonpayable',
    inputs: [
      { name: 'provider',    type: 'address' },
      { name: 'evaluator',   type: 'address' },
      { name: 'expiredAt',   type: 'uint256' },
      { name: 'description', type: 'string'  },
      { name: 'hook',        type: 'address' },
    ],
    outputs: [{ name: 'jobId', type: 'uint256' }],
  },
  {
    type: 'function', name: 'setBudget', stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId',     type: 'uint256' },
      { name: 'amount',    type: 'uint256' },
      { name: 'optParams', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'fund', stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId',     type: 'uint256' },
      { name: 'optParams', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'submit', stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId',       type: 'uint256' },
      { name: 'deliverable', type: 'bytes32' },
      { name: 'optParams',   type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'complete', stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId',     type: 'uint256' },
      { name: 'reason',    type: 'bytes32' },
      { name: 'optParams', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'getJob', stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [{
      type: 'tuple', components: [
        { name: 'id',          type: 'uint256' },
        { name: 'client',      type: 'address' },
        { name: 'provider',    type: 'address' },
        { name: 'evaluator',   type: 'address' },
        { name: 'description', type: 'string'  },
        { name: 'budget',      type: 'uint256' },
        { name: 'expiredAt',   type: 'uint256' },
        { name: 'status',      type: 'uint8'   },
        { name: 'hook',        type: 'address' },
      ],
    }],
  },
  {
    type: 'event', name: 'JobCreated', anonymous: false,
    inputs: [
      { indexed: true,  name: 'jobId',     type: 'uint256' },
      { indexed: true,  name: 'client',    type: 'address' },
      { indexed: true,  name: 'provider',  type: 'address' },
      { indexed: false, name: 'evaluator', type: 'address' },
      { indexed: false, name: 'expiredAt', type: 'uint256' },
      { indexed: false, name: 'hook',      type: 'address' },
    ],
  },
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

export function isValidAddress(a: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(a);
}

export function usdcAmountToBaseUnits(amountUsdc: number | string): string {
  const n = typeof amountUsdc === 'string' ? Number(amountUsdc) : amountUsdc;
  if (!isFinite(n) || n <= 0) throw new Error('Amount must be a positive number');
  return BigInt(Math.round(n * 1_000_000)).toString();
}

export function bytes32FromText(text: string): Hex {
  return keccak256(toHex(text));
}

export interface CreateJobInput {
  walletId: string;
  walletAddress: string;
  providerAddress: string;
  evaluatorAddress: string;
  expiredAtSec: number;
  description: string;
  hook?: string;
}

export interface CreateJobResult {
  jobId: string;
  txHash: string;
}

export async function createJob(input: CreateJobInput): Promise<CreateJobResult> {
  const { walletId, providerAddress, evaluatorAddress, expiredAtSec, description } = input;
  const hook = input.hook && isValidAddress(input.hook) ? input.hook : ZERO_ADDRESS;
  if (!isValidAddress(providerAddress)) throw new Error('Invalid provider address');
  if (!isValidAddress(evaluatorAddress)) throw new Error('Invalid evaluator address');
  if (!Number.isInteger(expiredAtSec) || expiredAtSec <= Math.floor(Date.now() / 1000)) {
    throw new Error('expiredAt must be a future unix timestamp');
  }
  if (!description || description.length === 0 || description.length > 500) {
    throw new Error('description must be 1-500 characters');
  }

  const client = getClient();
  const r = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: 'createJob(address,address,uint256,string,address)',
    abiParameters: [providerAddress, evaluatorAddress, expiredAtSec.toString(), description, hook],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const txId = (r.data as { id?: string })?.id;
  if (!txId) throw new Error('createJob failed to submit');

  const txHash = await waitTxHash(client, txId);
  const receipt = await publicClient().getTransactionReceipt({ hash: txHash as Hex });

  let jobId: string | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== AGENTIC_COMMERCE_CONTRACT.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: AGENTIC_COMMERCE_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName === 'JobCreated') {
        jobId = (decoded.args as { jobId: bigint }).jobId.toString();
        break;
      }
    } catch { /* not our event */ }
  }
  if (!jobId) {
    logger.warn('jobs', `createJob ${txHash}: JobCreated event not found in receipt logs`);
    throw new Error('JobCreated event not found in transaction receipt');
  }
  return { jobId, txHash };
}

export interface JobActionResult {
  txHash: string;
}

export async function setJobBudget(walletId: string, jobId: string, amountUsdc: number | string): Promise<JobActionResult> {
  const baseUnits = usdcAmountToBaseUnits(amountUsdc);
  const client = getClient();
  const r = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: 'setBudget(uint256,uint256,bytes)',
    abiParameters: [jobId, baseUnits, '0x'],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const txId = (r.data as { id?: string })?.id;
  if (!txId) throw new Error('setBudget failed to submit');
  const txHash = await waitTxHash(client, txId);
  return { txHash };
}

export async function approveUsdcForJobs(walletId: string, amountUsdc: number | string): Promise<JobActionResult> {
  const baseUnits = usdcAmountToBaseUnits(amountUsdc);
  const client = getClient();
  const r = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: USDC_ADDRESS,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [AGENTIC_COMMERCE_CONTRACT, baseUnits],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const txId = (r.data as { id?: string })?.id;
  if (!txId) throw new Error('approve failed to submit');
  const txHash = await waitTxHash(client, txId);
  return { txHash };
}

export async function fundJob(walletId: string, jobId: string): Promise<JobActionResult> {
  const client = getClient();
  const r = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: 'fund(uint256,bytes)',
    abiParameters: [jobId, '0x'],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const txId = (r.data as { id?: string })?.id;
  if (!txId) throw new Error('fund failed to submit');
  const txHash = await waitTxHash(client, txId);
  return { txHash };
}

export async function submitDeliverable(walletId: string, jobId: string, deliverableHash: string): Promise<JobActionResult> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(deliverableHash)) throw new Error('deliverableHash must be a 0x-prefixed 32-byte hex string');
  const client = getClient();
  const r = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: 'submit(uint256,bytes32,bytes)',
    abiParameters: [jobId, deliverableHash, '0x'],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const txId = (r.data as { id?: string })?.id;
  if (!txId) throw new Error('submit failed to submit');
  const txHash = await waitTxHash(client, txId);
  return { txHash };
}

export async function completeJob(walletId: string, jobId: string, reasonHash: string): Promise<JobActionResult> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(reasonHash)) throw new Error('reasonHash must be a 0x-prefixed 32-byte hex string');
  const client = getClient();
  const r = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: 'complete(uint256,bytes32,bytes)',
    abiParameters: [jobId, reasonHash, '0x'],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const txId = (r.data as { id?: string })?.id;
  if (!txId) throw new Error('complete failed to submit');
  const txHash = await waitTxHash(client, txId);
  return { txHash };
}

export interface OnChainJob {
  id: string;
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  budgetUsdc: string;
  budgetBaseUnits: string;
  expiredAt: string;
  status: number;
  statusName: JobStatusName | 'Unknown';
  hook: string;
}

export async function getOnChainJob(jobId: string): Promise<OnChainJob | null> {
  try {
    const job = await publicClient().readContract({
      address: AGENTIC_COMMERCE_CONTRACT,
      abi: AGENTIC_COMMERCE_ABI,
      functionName: 'getJob',
      args: [BigInt(jobId)],
    }) as {
      id: bigint; client: Address; provider: Address; evaluator: Address;
      description: string; budget: bigint; expiredAt: bigint; status: number; hook: Address;
    };
    const status = Number(job.status);
    const statusName = (JOB_STATUS_NAMES[status] ?? 'Unknown') as JobStatusName | 'Unknown';
    const budgetUsdc = (Number(job.budget) / 1_000_000).toString();
    return {
      id: job.id.toString(),
      client: job.client,
      provider: job.provider,
      evaluator: job.evaluator,
      description: job.description,
      budgetUsdc,
      budgetBaseUnits: job.budget.toString(),
      expiredAt: job.expiredAt.toString(),
      status,
      statusName,
      hook: job.hook,
    };
  } catch (err) {
    logger.warn('jobs', `getJob(${jobId}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
