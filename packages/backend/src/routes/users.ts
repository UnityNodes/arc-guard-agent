import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { requireAuth, AuthRequest } from '../middleware/auth';
import crypto from 'crypto';

export const usersRouter = Router();
usersRouter.use(requireAuth);

// POST /api/users/telegram/link, generate a one-time code to link Telegram
usersRouter.post('/telegram/link', async (req: AuthRequest, res: Response): Promise<void> => {
  const code = crypto.randomBytes(4).toString('hex').toUpperCase(); // e.g. "A1B2C3D4"
  const key = `link:${code}`;

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Store code → walletAddress in Redis for 10 minutes
  await redis.set(key, user.walletAddress, 'EX', 600);

  res.json({
    code,
    expiresIn: 600,
    botUsername: 'GuardAgentAlertsBot',
    instruction: `Send /link ${code} to @GuardAgentAlertsBot on Telegram`,
  });
});

// POST /api/users/telegram/test, send a test message to the linked chat
usersRouter.post('/telegram/test', async (req: AuthRequest, res: Response): Promise<void> => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    res.status(503).json({ error: 'Telegram bot is not configured on the server' });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { telegramChatId: true },
  });
  if (!user?.telegramChatId) {
    res.status(400).json({ error: 'Telegram is not linked. Connect it first.' });
    return;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: user.telegramChatId,
        text: 'GuardAgent test notification, your alerts are wired up correctly.',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      res.status(502).json({ error: `Telegram rejected the message (${r.status})`, detail: detail.slice(0, 200) });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to reach Telegram' });
  }
});

// DELETE /api/users/telegram, unlink Telegram
usersRouter.delete('/telegram', async (req: AuthRequest, res: Response): Promise<void> => {
  await prisma.user.update({
    where: { id: req.userId! },
    data: { telegramChatId: null, telegramLinked: false },
  });
  res.json({ ok: true });
});

// GET /api/users/me, current user info
usersRouter.get('/me', async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: {
      id: true,
      walletAddress: true,
      email: true,
      plan: true,
      telegramChatId: true,
      telegramLinked: true,
      autoMode: true,
      escalation1Min: true,
      escalation2Min: true,
      escalation3Min: true,
      autoExecMin: true,
      createdAt: true,
      _count: { select: { rules: true, alerts: true } },
    },
  });
  res.json({ user });
});

// POST /api/users/auto-mode, toggle autoMode
usersRouter.post('/auto-mode', async (req: AuthRequest, res: Response): Promise<void> => {
  const { autoMode } = req.body as { autoMode: boolean };
  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: { autoMode: !!autoMode },
    select: { autoMode: true },
  });
  res.json({ ok: true, autoMode: user.autoMode });
});

// PATCH /api/users/me, update user profile fields (autoMode)
usersRouter.patch('/me', async (req: AuthRequest, res: Response): Promise<void> => {
  const { autoMode } = req.body as { autoMode?: boolean };
  const data: Record<string, unknown> = {};
  if (autoMode !== undefined) data.autoMode = !!autoMode;
  const user = await prisma.user.update({ where: { id: req.userId! }, data, select: { autoMode: true } });
  res.json({ ok: true, ...user });
});

// PUT /api/users/escalation, update escalation timings
usersRouter.put('/escalation', async (req: AuthRequest, res: Response): Promise<void> => {
  const { escalation1Min, escalation2Min, escalation3Min, autoExecMin } = req.body as {
    escalation1Min?: number; escalation2Min?: number; escalation3Min?: number; autoExecMin?: number;
  };

  // Validate: all must be positive integers, and timings must be in ascending order
  const data: Record<string, number> = {};
  if (escalation1Min !== undefined) {
    if (!Number.isInteger(escalation1Min) || escalation1Min < 1 || escalation1Min > 60) {
      res.status(400).json({ error: 'escalation1Min must be 1-60' }); return;
    }
    data.escalation1Min = escalation1Min;
  }
  if (escalation2Min !== undefined) {
    if (!Number.isInteger(escalation2Min) || escalation2Min < 1 || escalation2Min > 120) {
      res.status(400).json({ error: 'escalation2Min must be 1-120' }); return;
    }
    data.escalation2Min = escalation2Min;
  }
  if (escalation3Min !== undefined) {
    if (!Number.isInteger(escalation3Min) || escalation3Min < 1 || escalation3Min > 180) {
      res.status(400).json({ error: 'escalation3Min must be 1-180' }); return;
    }
    data.escalation3Min = escalation3Min;
  }
  if (autoExecMin !== undefined) {
    if (!Number.isInteger(autoExecMin) || autoExecMin < 1 || autoExecMin > 240) {
      res.status(400).json({ error: 'autoExecMin must be 1-240' }); return;
    }
    data.autoExecMin = autoExecMin;
  }

  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' }); return;
  }

  const user = await prisma.user.update({
    where: { id: req.userId! },
    data,
    select: { escalation1Min: true, escalation2Min: true, escalation3Min: true, autoExecMin: true },
  });

  res.json({ ok: true, ...user });
});
