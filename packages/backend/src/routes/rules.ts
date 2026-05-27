import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const rulesRouter = Router();
rulesRouter.use(requireAuth);

const bridgeActionConfig = z.object({
  toChain: z.string().min(1),
  amountUsdc: z.string().regex(/^\d+(\.\d+)?$/),
  destAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

const ruleSchema = z.object({
  name: z.string().min(1).max(100),
  token: z.string().min(1),
  tokenSymbol: z.string().min(1).max(10),
  condition: z.enum(['ABOVE', 'BELOW']),
  threshold: z.number().positive(),
  cooldownMin: z.number().int().min(1).max(1440).optional().default(60),
  // Wave 2, autonomous actions
  action: z.enum(['ALERT', 'BRIDGE']).optional().default('ALERT'),
  triggerType: z.enum(['PRICE', 'BALANCE_USDC_GTE']).optional().default('PRICE'),
  actionConfig: z.union([bridgeActionConfig, z.null()]).optional(),
});

function validateRuleConsistency(d: z.infer<typeof ruleSchema>): string | null {
  if (d.action === 'BRIDGE' && !bridgeActionConfig.safeParse(d.actionConfig).success) {
    return 'BRIDGE action requires actionConfig with toChain + amountUsdc';
  }
  return null;
}

// GET /api/rules
rulesRouter.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const rules = await prisma.rule.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ rules });
});

// POST /api/rules
rulesRouter.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const consistencyErr = validateRuleConsistency(parsed.data);
  if (consistencyErr) {
    res.status(400).json({ error: consistencyErr });
    return;
  }

  const rulesCount = await prisma.rule.count({ where: { userId: req.userId! } });
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  const maxRules = user?.plan === 'PRO' ? 100 : 10;

  if (rulesCount >= maxRules) {
    res.status(403).json({ error: `Free plan allows max ${maxRules} rules. Upgrade to Pro.` });
    return;
  }

  const rule = await prisma.rule.create({
    data: {
      userId: req.userId!,
      name: parsed.data.name,
      token: parsed.data.token,
      tokenSymbol: parsed.data.tokenSymbol,
      condition: parsed.data.condition,
      threshold: parsed.data.threshold,
      cooldownMin: parsed.data.cooldownMin,
      action: parsed.data.action,
      triggerType: parsed.data.triggerType,
      ...(parsed.data.actionConfig ? { actionConfig: parsed.data.actionConfig } : {}),
    },
  });
  res.status(201).json({ rule });
});

// PATCH /api/rules/:id
rulesRouter.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  const rule = await prisma.rule.findFirst({
    where: { id, userId: req.userId! },
  });
  if (!rule) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  const partial = ruleSchema.partial().safeParse(req.body);
  if (!partial.success) {
    res.status(400).json({ error: partial.error.flatten() });
    return;
  }

  // Strip actionConfig if present (Prisma Json vs Zod object shape mismatch in update), handle separately.
  const { actionConfig, ...rest } = partial.data;
  const updated = await prisma.rule.update({
    where: { id },
    data: {
      ...rest,
      ...(actionConfig !== undefined ? { actionConfig: actionConfig ?? undefined } : {}),
    },
  });
  res.json({ rule: updated });
});

// DELETE /api/rules/:id
rulesRouter.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  const rule = await prisma.rule.findFirst({
    where: { id, userId: req.userId! },
  });
  if (!rule) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  await prisma.rule.delete({ where: { id } });
  res.json({ ok: true });
});

// POST /api/rules/seed-demo, create a tiny set of starter rules so that a
// new user (and hackathon judges) immediately see /alerts, /dashboard and
// /guardian populated instead of empty. Idempotent: skips if any rule
// already exists for this user.
rulesRouter.post('/seed-demo', async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.rule.count({ where: { userId: req.userId! } });
  if (existing > 0) {
    res.json({ ok: true, skipped: 'user already has rules', count: existing });
    return;
  }
  const presets = [
    { name: 'USDC depeg watch',     tokenSymbol: 'USDC', condition: 'BELOW' as const, threshold: 0.995, cooldownMin: 30 },
    { name: 'EURC > 1.10 alert',    tokenSymbol: 'EURC', condition: 'ABOVE' as const, threshold: 1.10,  cooldownMin: 60 },
    { name: 'USDC premium alert',   tokenSymbol: 'USDC', condition: 'ABOVE' as const, threshold: 1.005, cooldownMin: 30 },
  ];
  const created = [];
  for (const p of presets) {
    const r = await prisma.rule.create({
      data: {
        userId: req.userId!,
        name: p.name,
        token: p.tokenSymbol.toLowerCase(),
        tokenSymbol: p.tokenSymbol,
        condition: p.condition,
        threshold: p.threshold,
        cooldownMin: p.cooldownMin,
        action: 'ALERT',
        triggerType: 'PRICE',
      },
    });
    created.push(r);
  }
  res.status(201).json({ ok: true, created: created.length, rules: created });
});

// POST /api/rules/:id/toggle
rulesRouter.post('/:id/toggle', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  const rule = await prisma.rule.findFirst({
    where: { id, userId: req.userId! },
  });
  if (!rule) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  const updated = await prisma.rule.update({
    where: { id },
    data: { isActive: !rule.isActive },
  });
  res.json({ rule: updated });
});
