declare module '@circle-fin/usdckit/providers/circle-wallets' {
  import type { Transport } from 'viem';
  export function http(config: {
    apiKey: string;
    entitySecret: string;
    chainId: number;
    baseUrl?: string;
  }): Transport;
}
