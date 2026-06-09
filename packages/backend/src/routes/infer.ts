import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';

// ── x402 / Nanopayments ───────────────────────────────────────────────────────
// GuardAgent AI exposes a pay-per-inference endpoint via Circle x402 Gateway.
// Any wallet with USDC on Arc Testnet (or Base Sepolia) can call this endpoint
// without a GuardAgent account - pay $0.001 USDC per query, receive AI response.
//
// Seller address receives the USDC on the Arc network.
// See: https://developers.circle.com/stablecoins/nanopayments
// ─────────────────────────────────────────────────────────────────────────────

const NANOPAY_SELLER_ADDRESS = process.env.SELLER_WALLET_ADDRESS || '';
const INFER_PRICE = process.env.INFER_PRICE_USD || '$0.001';

// X402_FACILITATOR_URL controls which Circle Gateway facilitator to use:
//   Testnet: https://gateway-api-testnet.circle.com  (supports Arc Testnet eip155:5042002)
//   Mainnet: https://gateway-api.circle.com          (supports Ethereum, Base, Arbitrum...)
// Default is the testnet facilitator for hackathon demo purposes.
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://gateway-api-testnet.circle.com';

// Networks supported by the testnet facilitator (from /v1/x402/supported):
const TESTNET_NETWORKS = [
  'eip155:5042002',    // Arc Testnet ← our primary chain
  'eip155:84532',      // Base Sepolia
  'eip155:11155111',   // Ethereum Sepolia
  'eip155:421614',     // Arbitrum Sepolia
];

const MAINNET_NETWORKS = [
  'eip155:8453',   // Base Mainnet
  'eip155:1',      // Ethereum Mainnet
  'eip155:42161',  // Arbitrum One
  'eip155:10',     // Optimism
  'eip155:137',    // Polygon
];

const IS_TESTNET = FACILITATOR_URL.includes('testnet');
const ACTIVE_NETWORKS = IS_TESTNET ? TESTNET_NETWORKS : MAINNET_NETWORKS;

// NANOPAY_DEMO_MODE=true → skip x402 entirely (for local dev without any facilitator)
const DEMO_MODE = process.env.NANOPAY_DEMO_MODE === 'true';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GatewayInstance = { require: (price: string) => RequestHandler } | null;

let _gateway: GatewayInstance = null;

function getGateway(): GatewayInstance {
  if (_gateway) return _gateway;
  if (!NANOPAY_SELLER_ADDRESS || DEMO_MODE) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createGatewayMiddleware } = require('@circle-fin/x402-batching/server') as {
      createGatewayMiddleware: (cfg: {
        sellerAddress: string;
        networks?: string[];
        facilitatorUrl?: string;
      }) => GatewayInstance;
    };
    _gateway = createGatewayMiddleware({
      sellerAddress: NANOPAY_SELLER_ADDRESS,
      networks: ACTIVE_NETWORKS,
      facilitatorUrl: FACILITATOR_URL,
    });
    logger.info('nanopay', `x402 Gateway ready - facilitator=${FACILITATOR_URL}, networks=[${ACTIVE_NETWORKS.join(', ')}], seller=${NANOPAY_SELLER_ADDRESS}, price=${INFER_PRICE}`);
  } catch (err) {
    logger.error('nanopay', 'Failed to init x402 Gateway middleware', err);
  }
  return _gateway;
}

// ── Anthropic client ──────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

const SYSTEM_PROMPT = `You are GuardAgent AI, a DeFi portfolio guardian and financial intelligence assistant built on the Arc blockchain powered by Circle.

You help users with:
- USDC and stablecoin markets on Arc
- Cross-chain transfers via CCTP Bridge Kit
- DeFi yield opportunities (USYC earn, liquidity pools)
- Autonomous agent portfolio management
- Risk management and Guardian policy design
- Pay-per-use agentic economy concepts on Arc

Keep responses concise (3-6 sentences max). Prioritize actionable insights. Mention relevant Circle products (USDC, CCTP, Circle Wallets, Gateway, Nanopayments) where fitting.`;

// ── Router ────────────────────────────────────────────────────────────────────

export const inferRouter = Router();

const inferBodySchema = z.object({
  prompt: z.string().min(1).max(2000),
});

// ── GET /api/infer/info - public endpoint info, no payment required ───────────

inferRouter.get('/info', (_req: Request, res: Response): void => {
  res.json({
    description: 'GuardAgent AI pay-per-inference endpoint. DeFi intelligence powered by Claude on Arc.',
    pricePerQuery: INFER_PRICE,
    sellerAddress: NANOPAY_SELLER_ADDRESS || 'not configured',
    paymentMode: DEMO_MODE ? 'demo (no payment - local dev)' : `x402 Circle Gateway (${IS_TESTNET ? 'testnet' : 'mainnet'})`,
    networks: DEMO_MODE ? [] : ACTIVE_NETWORKS.map(n => ({ caip2: n })),
    facilitatorUrl: DEMO_MODE ? null : FACILITATOR_URL,
    model: 'claude-haiku-4-5-20251001',
    protocol: 'x402 / Circle Gateway Nanopayments',
    docs: 'https://developers.circle.com/stablecoins/nanopayments',
    howToUse: DEMO_MODE
      ? ['POST /api/infer with {"prompt":"your question"} (demo mode - no payment)']
      : [
          `1. Fund a Circle Gateway wallet with USDC on ${IS_TESTNET ? 'Arc Testnet (eip155:5042002)' : 'a supported mainnet'}`,
          `2. POST to /api/infer - receive 402 with payment requirements`,
          `3. Pay ${INFER_PRICE} USDC to ${NANOPAY_SELLER_ADDRESS} via x402 payment header`,
          '4. Resend request with X-PAYMENT header - receive AI response',
        ],
  });
});

// ── GET /api/infer/stats - usage stats ───────────────────────────────────────

inferRouter.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [total, today] = await Promise.all([
      redis.get('nanopay:infer:total').catch(() => '0'),
      redis.get(`nanopay:infer:day:${new Date().toISOString().slice(0, 10)}`).catch(() => '0'),
    ]);
    res.json({
      totalInferences: Number(total ?? 0),
      todayInferences: Number(today ?? 0),
      pricePerQuery: INFER_PRICE,
      sellerAddress: NANOPAY_SELLER_ADDRESS || 'not configured',
      networksFunded: DEMO_MODE ? [] : ACTIVE_NETWORKS,
    });
  } catch {
    res.status(500).json({ error: 'Stats unavailable' });
  }
});

// ── POST /api/infer - paid inference (x402 required) ─────────────────────────
//
// This is the core Nanopayments demo: every AI query costs exactly INFER_PRICE
// USDC, settled on Arc in real time via Circle Gateway.
//
// If SELLER_WALLET_ADDRESS is not configured (e.g. local dev), the endpoint
// falls through without payment so development isn't blocked.

function nanopayMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (DEMO_MODE) {
    logger.info('nanopay', 'Demo mode - bypassing x402 payment (NANOPAY_DEMO_MODE=true)');
    (req as unknown as Record<string, unknown>).payer = 'demo';
    next();
    return;
  }
  const gw = getGateway();
  if (!gw) {
    if (NANOPAY_SELLER_ADDRESS) {
      logger.error('nanopay', 'x402 gateway failed to init - refusing to serve unpaid inference');
      res.status(503).json({ error: 'Payment gateway unavailable, try again later' });
      return;
    }
    logger.warn('nanopay', 'No seller wallet configured - serving without payment (local dev)');
    next();
    return;
  }
  (gw.require(INFER_PRICE) as RequestHandler)(req, res, next);
}

inferRouter.post(
  '/',
  nanopayMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const parse = inferBodySchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'prompt required, max 2000 chars' });
      return;
    }

    const payer = (req as unknown as { payer?: string }).payer ?? null;
    const today = new Date().toISOString().slice(0, 10);

    try {
      const aiRes = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: parse.data.prompt }],
      });

      const text = aiRes.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';

      await Promise.all([
        redis.incr('nanopay:infer:total').catch(() => null),
        redis.incr(`nanopay:infer:day:${today}`).catch(() => null),
        payer ? redis.incr(`nanopay:infer:payer:${payer}`).catch(() => null) : Promise.resolve(),
      ]);

      logger.info('nanopay', `Inference served payer=${payer ?? 'anon'} tokens=${aiRes.usage?.output_tokens}`);

      res.json({
        response: text,
        model: 'claude-haiku-4-5-20251001',
        paid: INFER_PRICE,
        network: 'Arc Testnet',
        payer,
        inputTokens: aiRes.usage?.input_tokens,
        outputTokens: aiRes.usage?.output_tokens,
      });
    } catch (err) {
      logger.error('nanopay', 'Inference failed', err);
      res.status(503).json({
        error: 'Inference temporarily unavailable. Payment will be refunded per x402 protocol.',
      });
    }
  },
);
