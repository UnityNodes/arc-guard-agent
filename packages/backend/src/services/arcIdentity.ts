import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { createPublicClient, http, keccak256, toHex, getAddress } from 'viem';
import { prisma } from '../lib/prisma';
import { logAudit } from './audit';
import { logger } from '../lib/logger';

const CIRCLE_API_KEY       = process.env.CIRCLE_API_KEY || '';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';
const IDENTITY_REGISTRY    = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const REPUTATION_REGISTRY  = '0x8004B663056A597Dffe9eCcC1965A193B7388713';
const ARC_RPC              = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network/';
const API_BASE            = process.env.NEXT_PUBLIC_API_URL || 'https://api.guardagent.org';
const ZERO_ADDRESS         = '0x0000000000000000000000000000000000000000';

const ERC721_READ_ABI = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'string' }] },
] as const;

function getClient() {
  return initiateDeveloperControlledWalletsClient({ apiKey: CIRCLE_API_KEY, entitySecret: CIRCLE_ENTITY_SECRET });
}

async function resolveAddress(walletId: string): Promise<string> {
  const r = await getClient().getWallet({ id: walletId });
  const address = r.data?.wallet?.address;
  if (!address) throw new Error('Cannot resolve agent wallet address');
  return address;
}

function topicToAddress(topic: string): string {
  return getAddress(`0x${topic.slice(-40)}`);
}

export function getAgentCard() {
  const address = process.env.SELLER_WALLET_ADDRESS || '';
  return {
    name: 'GuardAgent',
    description: 'Autonomous AI stablecoin-treasury agent with policy guardrails on Circle Arc. Buys (x402) and sells (x402) services, manages treasury across chains, and earns yield under a Guardian policy engine.',
    version: '1.0.0',
    address,
    network: 'arc-testnet',
    chainId: 5042002,
    capabilities: ['treasury-management', 'cross-chain-usdc', 'fx-swap', 'yield', 'x402-payments', 'policy-guardrails', 'multi-signer-approvals'],
    endpoints: { catalog: `${API_BASE}/api/sell/catalog` },
    registries: { identity: IDENTITY_REGISTRY, reputation: REPUTATION_REGISTRY, chainId: 5042002 },
  };
}

async function waitTxHash(client: ReturnType<typeof getClient>, txId: string, timeoutMs = 60_000): Promise<string | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await client.getTransaction({ id: txId });
    const tx = r.data?.transaction;
    const state = tx?.state ?? 'UNKNOWN';
    if (state === 'CONFIRMED' || state === 'COMPLETE') return tx?.txHash;
    if (state === 'FAILED' || state === 'CANCELLED' || state === 'DENIED') throw new Error(`register tx ${state}`);
    await new Promise((res) => setTimeout(res, 2_500));
  }
  return undefined;
}

export interface IdentityResult {
  agentId: string | null;
  txHash?: string;
  agentURI: string;
  registry: string;
  owner?: string | null;
  tokenURI?: string | null;
  verified?: boolean;
}

export async function verifyAgentId(agentId: bigint): Promise<{ owner: string | null; tokenURI: string | null }> {
  const pc = createPublicClient({ transport: http(ARC_RPC) });
  const [ownerRes, uriRes] = await Promise.allSettled([
    pc.readContract({ address: IDENTITY_REGISTRY, abi: ERC721_READ_ABI, functionName: 'ownerOf', args: [agentId] }),
    pc.readContract({ address: IDENTITY_REGISTRY, abi: ERC721_READ_ABI, functionName: 'tokenURI', args: [agentId] }),
  ]);
  return {
    owner: ownerRes.status === 'fulfilled' ? (ownerRes.value as string) : null,
    tokenURI: uriRes.status === 'fulfilled' ? (uriRes.value as string) : null,
  };
}

export async function registerAgentIdentity(walletId: string, userId: string): Promise<IdentityResult> {
  const client = getClient();
  const agentURI = `${API_BASE}/api/agent/card`;
  const ownerAddress = await resolveAddress(walletId);
  const r = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: IDENTITY_REGISTRY,
    abiFunctionSignature: 'register(string)',
    abiParameters: [agentURI],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const txId = (r.data as { id?: string })?.id;
  if (!txId) throw new Error('ERC-8004 register failed to submit');

  const txHash = await waitTxHash(client, txId);
  let agentId: string | null = null;
  let owner: string | null = null;
  let tokenURI: string | null = null;
  let verified = false;

  if (txHash) {
    try {
      const pc = createPublicClient({ transport: http(ARC_RPC) });
      const rec = await pc.getTransactionReceipt({ hash: txHash as `0x${string}` });
      const transferTopic = keccak256(toHex('Transfer(address,address,uint256)')).toLowerCase();
      const mints = rec.logs.filter(
        (l) =>
          l.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() &&
          l.topics[0]?.toLowerCase() === transferTopic &&
          l.topics.length === 4 &&
          topicToAddress(l.topics[1]!).toLowerCase() === ZERO_ADDRESS,
      );
      const mint = mints.at(-1);
      if (mint?.topics?.[3]) {
        const tokenId = BigInt(mint.topics[3]);
        agentId = tokenId.toString();
        const recipient = mint.topics[2] ? topicToAddress(mint.topics[2]) : null;
        const readback = await verifyAgentId(tokenId);
        owner = readback.owner ?? recipient;
        tokenURI = readback.tokenURI;
        verified =
          !!owner &&
          owner.toLowerCase() === ownerAddress.toLowerCase() &&
          (tokenURI == null || tokenURI === agentURI);
        if (!verified) {
          logger.warn('identity', `read-back mismatch agentId=${agentId} owner=${owner} expected=${ownerAddress} tokenURI=${tokenURI}`);
        }
      } else {
        logger.warn('identity', `no Transfer mint log from ${IDENTITY_REGISTRY} in tx ${txHash}`);
      }
    } catch (err) {
      logger.warn('identity', 'receipt parse failed', err);
    }
  }

  await logAudit({ userId, actor: 'agent', action: 'ERC8004_REGISTERED', detail: { agentId, txHash, agentURI, owner, tokenURI, verified } });
  return { agentId, txHash, agentURI, registry: IDENTITY_REGISTRY, owner, tokenURI, verified };
}

export async function getIdentityStatus(userId: string) {
  const last = await prisma.auditLog.findFirst({
    where: { userId, action: 'ERC8004_REGISTERED' },
    orderBy: { createdAt: 'desc' },
  });
  if (!last) return { registered: false, registry: IDENTITY_REGISTRY };
  const d = (last.detail ?? {}) as { agentId?: string | null; txHash?: string; owner?: string | null; tokenURI?: string | null; verified?: boolean };

  let onchainOwner: string | null = d.owner ?? null;
  let onchainVerified = false;
  if (d.agentId) {
    try {
      const readback = await verifyAgentId(BigInt(d.agentId));
      onchainOwner = readback.owner ?? d.owner ?? null;
      onchainVerified = !!readback.owner;
    } catch (err) {
      logger.warn('identity', `live ownerOf check failed for agentId=${d.agentId}`, err);
    }
  }

  return {
    registered: true,
    agentId: d.agentId ?? null,
    txHash: d.txHash ?? null,
    registry: IDENTITY_REGISTRY,
    owner: onchainOwner,
    tokenURI: d.tokenURI ?? null,
    verified: onchainVerified || !!d.verified,
  };
}
