import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { createPublicClient, http, keccak256, toHex, getAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { arcTestnet } from '../lib/chains';
import { logger } from '../lib/logger';

const CIRCLE_API_KEY       = process.env.CIRCLE_API_KEY || '';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';
const ARC_RPC              = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network/';

export const IDENTITY_REGISTRY   = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as Address;
export const VALIDATION_REGISTRY = '0x8004Cb1BF31DAf7788923b405b754f57acEB4272' as Address;
export const ZERO_ADDRESS        = '0x0000000000000000000000000000000000000000' as Address;
export const ZERO_BYTES32        = `0x${'0'.repeat(64)}` as Hex;

export const VALIDATION_ABI = [
  {
    type: 'function', name: 'validationRequest', stateMutability: 'nonpayable',
    inputs: [
      { name: 'validator',   type: 'address' },
      { name: 'agentId',     type: 'uint256' },
      { name: 'requestURI',  type: 'string'  },
      { name: 'requestHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'validationResponse', stateMutability: 'nonpayable',
    inputs: [
      { name: 'requestHash',  type: 'bytes32' },
      { name: 'response',     type: 'uint8'   },
      { name: 'responseURI',  type: 'string'  },
      { name: 'responseHash', type: 'bytes32' },
      { name: 'tag',          type: 'string'  },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'getValidationStatus', stateMutability: 'view',
    inputs: [{ name: 'requestHash', type: 'bytes32' }],
    outputs: [
      { name: 'validatorAddress', type: 'address' },
      { name: 'agentId',          type: 'uint256' },
      { name: 'response',         type: 'uint8'   },
      { name: 'responseHash',     type: 'bytes32' },
      { name: 'tag',              type: 'string'  },
      { name: 'lastUpdate',       type: 'uint256' },
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

export function bytes32FromText(text: string): Hex {
  return keccak256(toHex(text));
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
    logger.warn('validation', `ownerOf(${agentId}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface ValidationStatus {
  requestHash: string;
  validatorAddress: string;
  agentId: string;
  response: number;
  responseHash: string;
  tag: string;
  lastUpdate: string;
  exists: boolean;
  responded: boolean;
}

export async function getValidationStatus(requestHash: string): Promise<ValidationStatus> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(requestHash)) throw new Error('requestHash must be a 0x-prefixed 32-byte hex string');
  const tuple = await publicClient().readContract({
    address: VALIDATION_REGISTRY,
    abi: VALIDATION_ABI,
    functionName: 'getValidationStatus',
    args: [requestHash as Hex],
  }) as readonly [Address, bigint, number, Hex, string, bigint];

  const [validatorAddress, agentId, response, responseHash, tag, lastUpdate] = tuple;
  const exists = validatorAddress !== ZERO_ADDRESS;
  const responded = exists && (responseHash !== ZERO_BYTES32 || tag.length > 0 || response !== 0);
  return {
    requestHash,
    validatorAddress: getAddress(validatorAddress),
    agentId: agentId.toString(),
    response: Number(response),
    responseHash,
    tag,
    lastUpdate: lastUpdate.toString(),
    exists,
    responded,
  };
}

export interface RequestValidationInput {
  walletId: string;
  walletAddress: string;
  validatorAddress: string;
  agentId: string;
  requestURI?: string;
  requestHash?: string;
  requestText?: string;
}

export interface RequestValidationResult {
  txHash: string;
  requestHash: string;
  validator: string;
  agentId: string;
  requestURI: string;
}

export async function requestValidation(input: RequestValidationInput): Promise<RequestValidationResult> {
  const { walletId, walletAddress, validatorAddress, agentId } = input;
  if (!/^0x[a-fA-F0-9]{40}$/.test(validatorAddress)) throw new Error('Invalid validator address');
  if (!/^\d+$/.test(agentId)) throw new Error('agentId must be a positive integer string');
  if (validatorAddress.toLowerCase() === walletAddress.toLowerCase()) {
    throw new Error('Validator must be a different address than the requester');
  }

  const owner = await ownerOfAgent(agentId);
  if (!owner) throw new Error(`Agent ${agentId} not found in IdentityRegistry`);
  if (owner.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error('Only the agent owner can request validation for this agent');
  }

  const requestURI = input.requestURI ?? '';
  if (requestURI.length > 500) throw new Error('requestURI must be ≤500 characters');

  const requestHash = input.requestHash && /^0x[a-fA-F0-9]{64}$/.test(input.requestHash)
    ? input.requestHash
    : input.requestText
      ? bytes32FromText(input.requestText)
      : bytes32FromText(`validation_request_agent_${agentId}_${Date.now()}`);

  const client = getClient();
  const r = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: VALIDATION_REGISTRY,
    abiFunctionSignature: 'validationRequest(address,uint256,string,bytes32)',
    abiParameters: [validatorAddress, agentId, requestURI, requestHash],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const txId = (r.data as { id?: string })?.id;
  if (!txId) throw new Error('validationRequest failed to submit');
  const txHash = await waitTxHash(client, txId);

  return { txHash, requestHash, validator: validatorAddress, agentId, requestURI };
}

export interface SubmitResponseInput {
  walletId: string;
  walletAddress: string;
  requestHash: string;
  response: number;
  responseURI?: string;
  responseHash?: string;
  responseText?: string;
  tag: string;
}

export interface SubmitResponseResult {
  txHash: string;
  requestHash: string;
  responseHash: string;
  response: number;
  tag: string;
}

export async function submitValidationResponse(input: SubmitResponseInput): Promise<SubmitResponseResult> {
  const { walletId, walletAddress, requestHash, response, tag } = input;
  if (!/^0x[a-fA-F0-9]{64}$/.test(requestHash)) throw new Error('requestHash must be a 0x-prefixed 32-byte hex string');
  if (!Number.isInteger(response) || response < 0 || response > 255) {
    throw new Error('response must be a uint8 (0-255); typical 0=fail, 100=pass');
  }
  if (!tag || tag.length === 0 || tag.length > 80) throw new Error('tag must be 1-80 characters');
  const responseURI = input.responseURI ?? '';
  if (responseURI.length > 500) throw new Error('responseURI must be ≤500 characters');

  const status = await getValidationStatus(requestHash);
  if (!status.exists) throw new Error('No matching validation request found on-chain for this requestHash');
  if (status.validatorAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error(`This wallet (${walletAddress}) is not the named validator (${status.validatorAddress}) for this request`);
  }
  if (status.responded) throw new Error('This validation request already has a recorded response');

  const responseHash = input.responseHash && /^0x[a-fA-F0-9]{64}$/.test(input.responseHash)
    ? input.responseHash
    : input.responseText
      ? bytes32FromText(input.responseText)
      : ZERO_BYTES32;

  const client = getClient();
  const r = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: VALIDATION_REGISTRY,
    abiFunctionSignature: 'validationResponse(bytes32,uint8,string,bytes32,string)',
    abiParameters: [requestHash, response.toString(), responseURI, responseHash, tag],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const txId = (r.data as { id?: string })?.id;
  if (!txId) throw new Error('validationResponse failed to submit');
  const txHash = await waitTxHash(client, txId);

  return { txHash, requestHash, responseHash, response, tag };
}
