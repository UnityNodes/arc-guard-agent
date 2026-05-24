import { createPublicClient, http } from 'viem';
import type { Address, PublicClient } from 'viem';
import { logger } from '../lib/logger';

const ARC_RPC = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network/';
const USDC = '0x3600000000000000000000000000000000000000';
const GAS_DECIMALS = 18;
const INTRINSIC_TRANSFER_GAS = 21000n;
const ARC_RECOMMENDED_MAX_FEE_GWEI = '20';
const ARC_PRIORITY_FEE_GWEI = '0';

const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

function client(): PublicClient {
  return createPublicClient({ transport: http(ARC_RPC) });
}

function weiToUsd(wei: bigint): number {
  return Number(wei) / 10 ** GAS_DECIMALS;
}

async function estimateErc20TransferGas(c: PublicClient): Promise<bigint | null> {
  const account = (process.env.SELLER_WALLET_ADDRESS || USDC) as Address;
  try {
    return await c.estimateContractGas({
      address: USDC as Address,
      abi: ERC20_TRANSFER_ABI,
      functionName: 'transfer',
      args: [account, 0n],
      account,
    });
  } catch (err) {
    logger.warn('gas', 'erc20 transfer gas estimate failed', err);
    return null;
  }
}

export interface GasReport {
  network: string;
  gasToken: string;
  gasPriceGwei: string;
  baseFeePerGasGwei: string | null;
  maxPriorityFeePerGasGwei: string;
  recommendedMaxFeePerGasGwei: string;
  costs: {
    nativeTransferUsd: string;
    erc20TransferUsd: string | null;
  };
  note: string;
}

export async function getGasReport(): Promise<GasReport> {
  const c = client();
  const [gasPrice, block, erc20Gas] = await Promise.all([
    c.getGasPrice(),
    c.getBlock().catch(() => null),
    estimateErc20TransferGas(c),
  ]);
  const usdFor = (gas: bigint) => weiToUsd(gasPrice * gas).toFixed(6);
  const baseFee = block?.baseFeePerGas ?? null;
  return {
    network: 'arc-testnet',
    gasToken: 'USDC',
    gasPriceGwei: (Number(gasPrice) / 1e9).toFixed(4),
    baseFeePerGasGwei: baseFee != null ? (Number(baseFee) / 1e9).toFixed(4) : null,
    maxPriorityFeePerGasGwei: ARC_PRIORITY_FEE_GWEI,
    recommendedMaxFeePerGasGwei: ARC_RECOMMENDED_MAX_FEE_GWEI,
    costs: {
      nativeTransferUsd: usdFor(INTRINSIC_TRANSFER_GAS),
      erc20TransferUsd: erc20Gas != null ? usdFor(erc20Gas) : null,
    },
    note: 'On Arc, USDC is the native gas token, so gas cost is denominated directly in USD. Native transfer uses the 21000 intrinsic-gas floor; ERC-20 transfer is measured via eth_estimateGas. Arc defaults maxPriorityFeePerGas to 0 and recommends a 20 Gwei maxFeePerGas floor (transactions below it may stay pending). For swap and bridge costs use the live quote endpoints, which return real protocol and gas fees.',
  };
}

export interface TxFee {
  txHash: string;
  gasUsed: string;
  effectiveGasPriceGwei: string;
  feeUsd: string;
  status: 'success' | 'reverted';
}

export async function getTxFeeUsd(txHash: string): Promise<TxFee> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new Error('Invalid transaction hash');
  const c = client();
  const r = await c.getTransactionReceipt({ hash: txHash as `0x${string}` });
  const fee = r.gasUsed * r.effectiveGasPrice;
  return {
    txHash,
    gasUsed: r.gasUsed.toString(),
    effectiveGasPriceGwei: (Number(r.effectiveGasPrice) / 1e9).toFixed(4),
    feeUsd: weiToUsd(fee).toFixed(6),
    status: r.status,
  };
}

export async function txFeeUsdSafe(txHash: string): Promise<string | null> {
  try {
    return (await getTxFeeUsd(txHash)).feeUsd;
  } catch (err) {
    logger.warn('gas', `txFeeUsd failed for ${txHash}`, err);
    return null;
  }
}
