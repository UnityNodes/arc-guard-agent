import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma';
import { PrivyClient } from '@privy-io/server-auth';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { logger } from '../lib/logger';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, try again in a few minutes' },
});

const meLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

const privyAuthSchema = z.object({
  accessToken: z.string().min(10),
  email: z.string().email().optional(),
});

function isPlaceholderAddress(addr: string): boolean {
  return addr.startsWith('privy:') || addr.startsWith('clerk:');
}

async function fetchPrivyWalletAddress(client: PrivyClient, privyUserId: string): Promise<string | null> {
  try {
    const pUser = await client.getUserById(privyUserId);
    const direct = pUser.wallet?.address;
    if (typeof direct === 'string' && direct.startsWith('0x')) return direct.toLowerCase();
    const fromAccounts = pUser.linkedAccounts?.find(
      (a) => a.type === 'wallet' && typeof (a as { address?: unknown }).address === 'string'
                && (a as { address: string }).address.startsWith('0x')
    ) as { address: string } | undefined;
    if (fromAccounts?.address) return fromAccounts.address.toLowerCase();
    return null;
  } catch (err) {
    logger.warn('auth', `getUserById failed, falling back to placeholder: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

authRouter.post('/privy', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const parsed = privyAuthSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'accessToken required' }); return; }
  if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
    res.status(503).json({ error: 'Privy not configured' }); return;
  }
  const { accessToken, email } = parsed.data;
  try {
    const client = new PrivyClient(process.env.PRIVY_APP_ID, process.env.PRIVY_APP_SECRET);
    const claims = await client.verifyAuthToken(accessToken);
    const privyUserId = claims.userId;

    // SECURITY: resolve the account strictly by the verified Privy identity.
    // Never match/link a pre-existing row by an unverified request-body email -
    // that allowed account takeover (attacker supplies a victim's email + own token).
    let user = await prisma.user.findUnique({ where: { privyUserId } });

    const needsPrivyLookup = !user || isPlaceholderAddress(user.walletAddress);
    const realEvm = needsPrivyLookup ? await fetchPrivyWalletAddress(client, privyUserId) : null;

    if (user) {
      let backfillAddress: string | null = null;
      if (realEvm && isPlaceholderAddress(user.walletAddress)) {
        const collision = await prisma.user.findUnique({ where: { walletAddress: realEvm } });
        if (!collision || collision.id === user.id) {
          backfillAddress = realEvm;
        } else {
          logger.warn('auth', `EVM ${realEvm} already owned by user ${collision.id}, keeping placeholder for ${user.id}`);
        }
      }
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          privyUserId,
          ...(email && !user.email ? { email } : {}),
          ...(backfillAddress ? { walletAddress: backfillAddress } : {}),
        },
      });
    } else {
      let createAddress = `privy:${privyUserId}`;
      if (realEvm) {
        const collision = await prisma.user.findUnique({ where: { walletAddress: realEvm } });
        if (!collision) createAddress = realEvm;
      }
      user = await prisma.user.create({
        data: {
          privyUserId,
          walletAddress: createAddress,
          email: email ?? null,
        },
      });
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const token = jwt.sign(
      { userId: user.id, walletAddress: user.walletAddress },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );
    await prisma.session.create({ data: { userId: user.id, token, expiresAt } });

    res.json({
      token,
      user: { id: user.id, email: user.email, walletAddress: user.walletAddress },
    });
  } catch (err) {
    logger.error('auth', `privy-auth error: ${err instanceof Error ? err.message : String(err)}`);
    const msg = err instanceof Error ? err.message : 'Auth failed';
    const lower = msg.toLowerCase();
    const isClientErr = lower.includes('invalid') || lower.includes('expired') || lower.includes('unauthor');
    res.status(isClientErr ? 401 : 500).json({ error: msg });
  }
});

authRouter.post('/logout', async (req: Request, res: Response): Promise<void> => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
  }
  res.json({ ok: true });
});

authRouter.get('/me', meLimiter, requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { id: true, walletAddress: true, email: true, plan: true, telegramLinked: true, isActive: true },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ user });
});
