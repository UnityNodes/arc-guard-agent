import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

export interface AuthRequest extends Request {
  userId?: string;
  walletAddress?: string;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // JWT only via Authorization: Bearer. Cookie fallback removed to prevent
  // latent CSRF if a maintainer ever adds cookie-parser with credentialed CORS.
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      walletAddress: string;
    };

    const session = await prisma.session.findUnique({
      where: { token },
    });

    if (!session || session.expiresAt < new Date()) {
      res.status(401).json({ error: 'Session expired' });
      return;
    }

    req.userId = payload.userId;
    req.walletAddress = payload.walletAddress;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
