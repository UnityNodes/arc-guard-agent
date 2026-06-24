/**
 * Test escalation timing validation logic from routes/users.ts
 * The validation rules:
 *   escalation1Min: 1-60
 *   escalation2Min: 1-120
 *   escalation3Min: 1-180
 *   autoExecMin:    1-240
 * All must be positive integers.
 */

// Replicate the validation logic from routes/users.ts (lines 96-129)
interface EscalationInput {
  escalation1Min?: number;
  escalation2Min?: number;
  escalation3Min?: number;
  autoExecMin?: number;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  data?: Record<string, number>;
}

function validateEscalation(input: EscalationInput): ValidationResult {
  const data: Record<string, number> = {};

  if (input.escalation1Min !== undefined) {
    if (!Number.isInteger(input.escalation1Min) || input.escalation1Min < 1 || input.escalation1Min > 60) {
      return { valid: false, error: 'escalation1Min must be 1-60' };
    }
    data.escalation1Min = input.escalation1Min;
  }
  if (input.escalation2Min !== undefined) {
    if (!Number.isInteger(input.escalation2Min) || input.escalation2Min < 1 || input.escalation2Min > 120) {
      return { valid: false, error: 'escalation2Min must be 1-120' };
    }
    data.escalation2Min = input.escalation2Min;
  }
  if (input.escalation3Min !== undefined) {
    if (!Number.isInteger(input.escalation3Min) || input.escalation3Min < 1 || input.escalation3Min > 180) {
      return { valid: false, error: 'escalation3Min must be 1-180' };
    }
    data.escalation3Min = input.escalation3Min;
  }
  if (input.autoExecMin !== undefined) {
    if (!Number.isInteger(input.autoExecMin) || input.autoExecMin < 1 || input.autoExecMin > 240) {
      return { valid: false, error: 'autoExecMin must be 1-240' };
    }
    data.autoExecMin = input.autoExecMin;
  }

  if (Object.keys(data).length === 0) {
    return { valid: false, error: 'No valid fields to update' };
  }

  return { valid: true, data };
}

describe('Escalation, valid ranges', () => {
  it('accepts escalation1Min in range 1-60', () => {
    expect(validateEscalation({ escalation1Min: 1 }).valid).toBe(true);
    expect(validateEscalation({ escalation1Min: 30 }).valid).toBe(true);
    expect(validateEscalation({ escalation1Min: 60 }).valid).toBe(true);
  });

  it('accepts escalation2Min in range 1-120', () => {
    expect(validateEscalation({ escalation2Min: 1 }).valid).toBe(true);
    expect(validateEscalation({ escalation2Min: 60 }).valid).toBe(true);
    expect(validateEscalation({ escalation2Min: 120 }).valid).toBe(true);
  });

  it('accepts escalation3Min in range 1-180', () => {
    expect(validateEscalation({ escalation3Min: 1 }).valid).toBe(true);
    expect(validateEscalation({ escalation3Min: 90 }).valid).toBe(true);
    expect(validateEscalation({ escalation3Min: 180 }).valid).toBe(true);
  });

  it('accepts autoExecMin in range 1-240', () => {
    expect(validateEscalation({ autoExecMin: 1 }).valid).toBe(true);
    expect(validateEscalation({ autoExecMin: 120 }).valid).toBe(true);
    expect(validateEscalation({ autoExecMin: 240 }).valid).toBe(true);
  });

  it('accepts all fields together with valid values', () => {
    const result = validateEscalation({
      escalation1Min: 5,
      escalation2Min: 15,
      escalation3Min: 30,
      autoExecMin: 60,
    });
    expect(result.valid).toBe(true);
    expect(result.data).toEqual({
      escalation1Min: 5,
      escalation2Min: 15,
      escalation3Min: 30,
      autoExecMin: 60,
    });
  });
});

describe('Escalation, invalid values', () => {
  it('rejects escalation1Min of 0', () => {
    const result = validateEscalation({ escalation1Min: 0 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('escalation1Min');
  });

  it('rejects negative escalation1Min', () => {
    const result = validateEscalation({ escalation1Min: -5 });
    expect(result.valid).toBe(false);
  });

  it('rejects escalation1Min above 60', () => {
    const result = validateEscalation({ escalation1Min: 61 });
    expect(result.valid).toBe(false);
  });

  it('rejects escalation2Min above 120', () => {
    const result = validateEscalation({ escalation2Min: 121 });
    expect(result.valid).toBe(false);
  });

  it('rejects escalation3Min above 180', () => {
    const result = validateEscalation({ escalation3Min: 181 });
    expect(result.valid).toBe(false);
  });

  it('rejects autoExecMin above 240', () => {
    const result = validateEscalation({ autoExecMin: 241 });
    expect(result.valid).toBe(false);
  });

  it('rejects fractional values', () => {
    expect(validateEscalation({ escalation1Min: 5.5 }).valid).toBe(false);
    expect(validateEscalation({ escalation2Min: 10.1 }).valid).toBe(false);
    expect(validateEscalation({ escalation3Min: 30.9 }).valid).toBe(false);
    expect(validateEscalation({ autoExecMin: 60.5 }).valid).toBe(false);
  });

  it('rejects empty input (no fields)', () => {
    const result = validateEscalation({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No valid fields');
  });
});

describe('Escalation, ascending order validation', () => {
  it('typical ascending timings are valid individually', () => {
    // Each field is validated independently in the route; ascending order
    // is a business expectation. We verify each passes its own range.
    const timings = { escalation1Min: 5, escalation2Min: 15, escalation3Min: 60, autoExecMin: 120 };
    const result = validateEscalation(timings);
    expect(result.valid).toBe(true);
    expect(result.data!.escalation1Min).toBeLessThan(result.data!.escalation2Min);
    expect(result.data!.escalation2Min).toBeLessThan(result.data!.escalation3Min);
    expect(result.data!.escalation3Min).toBeLessThan(result.data!.autoExecMin);
  });

  it('max boundary values maintain ascending order possibility', () => {
    // escalation1=60, escalation2=120, escalation3=180, auto=240
    const result = validateEscalation({
      escalation1Min: 60,
      escalation2Min: 120,
      escalation3Min: 180,
      autoExecMin: 240,
    });
    expect(result.valid).toBe(true);
  });

  it('min boundary values are all valid', () => {
    const result = validateEscalation({
      escalation1Min: 1,
      escalation2Min: 1,
      escalation3Min: 1,
      autoExecMin: 1,
    });
    expect(result.valid).toBe(true);
  });
});
