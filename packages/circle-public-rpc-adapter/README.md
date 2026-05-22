# @guardagent/circle-public-rpc-adapter

A drop-in **Circle Wallets adapter** for `@circle-fin/bridge-kit`, `unified-balance-kit` (Gateway), `swap-kit`, and `earn-kit` that performs on-chain **reads via a public RPC** instead of Circle's Smart Contract Platform *Query Contract* API.

## Why

The official `createCircleWalletsAdapter` routes every on-chain read (balances, allowances) through Circle's SCP *Query Contract* endpoint. On accounts without the SCP entitlement that endpoint returns **HTTP 403 `{"code":3,"message":"Forbidden"}`**, which breaks **every** Bridge Kit / Gateway / Swap / Earn flow at the balance-read step, even though CCTP and Gateway themselves are permissionless.

This adapter fixes that without waiting on an entitlement: **reads go to the public chain RPC, writes/signing still go through Circle developer-controlled-wallets.** It is what makes GuardAgentAI's bridge and Gateway flows work on Arc testnet today.

## Install

```bash
npm install @guardagent/circle-public-rpc-adapter
```

## Usage

```ts
import { createPublicRpcCircleAdapter } from '@guardagent/circle-public-rpc-adapter';
import { BridgeKit, ArcTestnet, BaseSepolia } from '@circle-fin/bridge-kit';

const adapter = createPublicRpcCircleAdapter({
  apiKey: process.env.CIRCLE_API_KEY!,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
  // optional per-chainId public RPC overrides; Arc testnet is built in
  publicRpc: { 5042002: 'https://rpc.testnet.arc.network/' },
});

const kit = new BridgeKit();
await kit.bridge({
  from: { adapter, chain: ArcTestnet, address: agentAddress },
  to: { chain: BaseSepolia, recipientAddress, useForwarder: true },
  amount: '1',
});
```

Works the same way with `UnifiedBalanceKit` (Gateway deposit/spend), `SwapKit`, and `EarnKit`, pass `adapter` in the `from` context.

## How it works

It builds a `ViemAdapter` (developer-controlled addressing) whose `getPublicClient` uses a plain viem HTTP transport against the public RPC, while `getWalletClient` keeps the Circle Wallets transport (`@circle-fin/usdckit/providers/circle-wallets`) so `eth_sendTransaction` and EIP-712 signing still flow through Circle DCW.

## License

MIT
