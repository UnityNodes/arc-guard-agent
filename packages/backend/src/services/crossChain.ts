import { logger } from '../lib/logger';
import { ARC_EXPLORER } from '../lib/chains';

export interface ChainBalance {
  chain: string;
  label: string;
  usdc: number;
  addressExplorerUrl: string;
  txExplorerBase: string;
  native: boolean;
}

interface ChainConfig {
  id: string;
  label: string;
  rpcUrls: string[];
  usdc: string;
  explorer: string;
}

const BALANCE_OF = '0x70a08231';
const USDC_DECIMALS = 6;

const DEST_CHAINS: ChainConfig[] = [
  {
    id: 'base-sepolia',
    label: 'Base',
    rpcUrls: ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'],
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    explorer: 'https://sepolia.basescan.org',
  },
  {
    id: 'ethereum-sepolia',
    label: 'Ethereum',
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org'],
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    explorer: 'https://sepolia.etherscan.io',
  },
];

export function txExplorerForChain(chain: string, hash: string): string | null {
  if (!hash) return null;
  if (chain === 'arc-testnet') return `${ARC_EXPLORER}/tx/${hash}`;
  const cfg = DEST_CHAINS.find((c) => c.id === chain);
  return cfg ? `${cfg.explorer}/tx/${hash}` : null;
}

export function chainLabel(chain: string): string {
  if (chain === 'arc-testnet') return 'Arc';
  return DEST_CHAINS.find((c) => c.id === chain)?.label ?? chain;
}

async function rpcCall(rpcUrls: string[], method: string, params: unknown[]): Promise<string> {
  for (const url of rpcUrls) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
        signal: AbortSignal.timeout(6000),
      });
      const d = (await r.json()) as { result?: string; error?: unknown };
      if (d.result && d.result !== '0x') return d.result;
      if (d.error) continue;
      return d.result ?? '0x0';
    } catch (err) {
      logger.warn('crosschain', `RPC ${method} failed on ${url}, trying next`, err);
      continue;
    }
  }
  return '0x0';
}

async function readUsdc(cfg: ChainConfig, address: string): Promise<number> {
  const data = BALANCE_OF + address.toLowerCase().slice(2).padStart(64, '0');
  const hex = await rpcCall(cfg.rpcUrls, 'eth_call', [{ to: cfg.usdc, data }, 'latest']);
  try {
    return Number(BigInt(hex || '0x0')) / Math.pow(10, USDC_DECIMALS);
  } catch {
    return 0;
  }
}

export async function getDestinationBalances(address: string): Promise<ChainBalance[]> {
  const results = await Promise.all(
    DEST_CHAINS.map(async (cfg) => {
      const usdc = await readUsdc(cfg, address).catch(() => 0);
      return {
        chain: cfg.id,
        label: cfg.label,
        usdc,
        addressExplorerUrl: `${cfg.explorer}/address/${address}`,
        txExplorerBase: `${cfg.explorer}/tx`,
        native: false,
      };
    }),
  );
  return results;
}
