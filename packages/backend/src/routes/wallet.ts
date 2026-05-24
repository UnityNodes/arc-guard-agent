import { Router, Request, Response } from 'express';
import { getPrices } from '../services/pyth';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';

export const walletRouter = Router();

// GET /api/wallet/prices?tokens=ETH,USDC,BTC  (public, prices are public data)
// Redis-cached for 15s to handle 1000+ concurrent users hitting same endpoint
walletRouter.get('/prices', async (req: Request, res: Response): Promise<void> => {
  const raw = (req.query.tokens as string) || 'ETH,USDC,BTC';
  const tokens = raw.split(',').filter(Boolean).slice(0, 20); // cap at 20 tokens

  // Validate token symbols
  const valid = tokens.every(t => /^[A-Za-z0-9]{1,10}$/.test(t));
  if (!valid) {
    res.status(400).json({ error: 'Invalid token symbol' });
    return;
  }

  try {
    const prices = await getPrices(tokens);
    res.json({ prices });
  } catch (err) {
    logger.error('wallet', `prices error: ${err instanceof Error ? err.message : String(err)}`);
    res.status(503).json({ error: 'Price feed temporarily unavailable' });
  }
});
