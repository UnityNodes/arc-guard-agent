declare module '@x402/core/client' {
  export class x402Client {
    constructor(config?: unknown);
    register(network: string, client: { readonly scheme: string }): unknown;
  }

  export type x402PaymentResult =
    | { kind: 'success'; response: Response; body: unknown; settleResponse: unknown }
    | { kind: 'settle_failed'; response: Response; body: unknown; settleResponse: unknown }
    | { kind: 'payment_required'; response: Response; paymentRequired: unknown }
    | { kind: 'error'; response: Response; status: number; body: unknown }
    | { kind: 'passthrough'; response: Response; body: unknown };

  export class x402HTTPClient {
    constructor(client: x402Client);
    getPaymentRequiredResponse(
      getHeader: (name: string) => string | null | undefined,
      body?: unknown,
    ): unknown;
    createPaymentPayload(paymentRequired: unknown): Promise<unknown>;
    encodePaymentSignatureHeader(paymentPayload: unknown): Record<string, string>;
    processResponse(response: Response): Promise<x402PaymentResult>;
  }
}

declare module '@circle-fin/x402-batching/client' {
  import type { Address, Hex } from 'viem';

  export interface BatchEvmSigner {
    address: Address;
    signTypedData: (params: {
      domain: { name: string; version: string; chainId: number; verifyingContract: Address };
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => Promise<Hex>;
  }

  export function registerBatchScheme(
    client: unknown,
    config: { signer: BatchEvmSigner; networks?: string[]; fallbackScheme?: unknown },
  ): unknown;
}

declare module '@circle-fin/x402-batching/server' {
  import type { RequestHandler } from 'express';
  export interface GatewayMiddlewareConfig {
    sellerAddress: string;
    networks?: string | string[];
    facilitatorUrl?: string;
  }
  export interface GatewayMiddleware {
    require: (price: string) => RequestHandler;
  }
  export function createGatewayMiddleware(config: GatewayMiddlewareConfig): GatewayMiddleware;
}
