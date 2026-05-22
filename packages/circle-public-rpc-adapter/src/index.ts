import { ViemAdapter } from '@circle-fin/adapter-viem-v2';
import { http as circleWalletsTransport } from '@circle-fin/usdckit/providers/circle-wallets';
import { UnifiedBalanceKit } from '@circle-fin/unified-balance-kit';
import { createPublicClient, createWalletClient, http } from 'viem';

export interface PublicRpcAdapterOptions {
  apiKey: string;
  entitySecret: string;
  publicRpc?: Record<number, string>;
  baseUrl?: string;
}

const DEFAULT_PUBLIC_RPC: Record<number, string> = {
  5042002: 'https://rpc.testnet.arc.network/',
};

export function createPublicRpcCircleAdapter(options: PublicRpcAdapterOptions): ViemAdapter {
  const rpc = { ...DEFAULT_PUBLIC_RPC, ...(options.publicRpc ?? {}) };

  const evmChains = new UnifiedBalanceKit()
    .getSupportedChains()
    .filter((c: { type?: string; chainId?: number }) => c.type === 'evm' && !!c.chainId);

  return new ViemAdapter(
    {
      getPublicClient: ({ chain }: { chain: { id: number } }) =>
        createPublicClient({ chain: chain as never, transport: http(rpc[chain.id]) }),
      getWalletClient: ({ chain }: { chain: { id: number } }) =>
        createWalletClient({
          chain: chain as never,
          transport: circleWalletsTransport({
            apiKey: options.apiKey,
            entitySecret: options.entitySecret,
            chainId: chain.id,
            ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
          }),
        }),
    } as never,
    { addressContext: 'developer-controlled', supportedChains: evmChains } as never,
  );
}
