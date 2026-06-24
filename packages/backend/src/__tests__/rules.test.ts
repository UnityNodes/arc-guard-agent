import { z } from 'zod';

// Replicate the exact Zod schema from routes/rules.ts
const ruleSchema = z.object({
  name: z.string().min(1).max(100),
  token: z.string().min(1),
  tokenSymbol: z.string().min(1).max(10),
  condition: z.enum(['ABOVE', 'BELOW']),
  threshold: z.number().positive(),
  cooldownMin: z.number().int().min(1).max(1440).optional().default(60),
});

describe('Rules. Zod schema validation', () => {
  const validRule = {
    name: 'ETH price alert',
    token: '0x1234567890abcdef',
    tokenSymbol: 'ETH',
    condition: 'ABOVE' as const,
    threshold: 3000,
    cooldownMin: 30,
  };

  it('accepts a fully valid rule', () => {
    const result = ruleSchema.safeParse(validRule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('ETH price alert');
      expect(result.data.condition).toBe('ABOVE');
      expect(result.data.threshold).toBe(3000);
      expect(result.data.cooldownMin).toBe(30);
    }
  });

  it('defaults cooldownMin to 60 when omitted', () => {
    const { cooldownMin, ...withoutCooldown } = validRule;
    const result = ruleSchema.safeParse(withoutCooldown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cooldownMin).toBe(60);
    }
  });

  it('accepts BELOW condition', () => {
    const result = ruleSchema.safeParse({ ...validRule, condition: 'BELOW' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.condition).toBe('BELOW');
    }
  });

  it('rejects invalid condition type', () => {
    const result = ruleSchema.safeParse({ ...validRule, condition: 'EQUALS' });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = ruleSchema.safeParse({ ...validRule, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name longer than 100 characters', () => {
    const result = ruleSchema.safeParse({ ...validRule, name: 'x'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('rejects negative threshold', () => {
    const result = ruleSchema.safeParse({ ...validRule, threshold: -100 });
    expect(result.success).toBe(false);
  });

  it('rejects zero threshold', () => {
    const result = ruleSchema.safeParse({ ...validRule, threshold: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects fractional cooldown', () => {
    const result = ruleSchema.safeParse({ ...validRule, cooldownMin: 30.5 });
    expect(result.success).toBe(false);
  });

  it('rejects cooldown of 0', () => {
    const result = ruleSchema.safeParse({ ...validRule, cooldownMin: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects cooldown above 1440', () => {
    const result = ruleSchema.safeParse({ ...validRule, cooldownMin: 1441 });
    expect(result.success).toBe(false);
  });

  it('accepts cooldown at boundary values (1 and 1440)', () => {
    expect(ruleSchema.safeParse({ ...validRule, cooldownMin: 1 }).success).toBe(true);
    expect(ruleSchema.safeParse({ ...validRule, cooldownMin: 1440 }).success).toBe(true);
  });

  it('rejects empty token', () => {
    const result = ruleSchema.safeParse({ ...validRule, token: '' });
    expect(result.success).toBe(false);
  });

  it('rejects tokenSymbol longer than 10 chars', () => {
    const result = ruleSchema.safeParse({ ...validRule, tokenSymbol: 'VERYLONGSYMBOL' });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(ruleSchema.safeParse({}).success).toBe(false);
    expect(ruleSchema.safeParse({ name: 'test' }).success).toBe(false);
  });
});
