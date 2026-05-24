import { createPublicRpcCircleAdapter } from '@guardagent/circle-public-rpc-adapter';

const CIRCLE_API_KEY       = process.env.CIRCLE_API_KEY || '';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';

// Circle's default adapter uses the hosted Circle RPC for chain reads. That
// RPC returns "Forbidden" on USDC.balanceOf for Arc Testnet, which makes
// BridgeKit fail preflight even though the wallet does have a balance.
// Routing reads through the public Arc RPC (rpc.testnet.arc.network) via the
// local public-rpc adapter package fixes it.
type CircleAdapter = ReturnType<typeof createPublicRpcCircleAdapter>;
let cached: CircleAdapter | null = null;

export function getCircleWalletsAdapter(): CircleAdapter {
  if (cached) return cached;
  cached = createPublicRpcCircleAdapter({
    apiKey: CIRCLE_API_KEY,
    entitySecret: CIRCLE_ENTITY_SECRET,
  });
  return cached;
}
