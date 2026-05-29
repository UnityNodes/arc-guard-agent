import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

export interface ParsedRule {
  name: string;
  tokenSymbol: string;
  condition: 'ABOVE' | 'BELOW';
  threshold: number;
  cooldownMin: number;
}

const SYSTEM_PROMPT = `You are a crypto price alert parser.
Extract rule parameters from natural language input and return ONLY valid JSON.
Supported tokens on Arc: USDC, EURC, USYC, use the exact symbol mentioned by the user.
Return format: {"name": string, "tokenSymbol": string, "condition": "ABOVE"|"BELOW", "threshold": number, "cooldownMin": number}
Rules:
- name: short descriptive name (max 50 chars)
- tokenSymbol: the token symbol in UPPERCASE exactly as the user mentioned it
- condition: ABOVE if price goes above/over/exceeds, BELOW if price drops/falls/goes below/under
- threshold: the price value in USD (number only)
- cooldownMin: alert cooldown in minutes (default 60 if not specified)
Examples:
"Alert me when USDC drops below $0.99" -> {"name":"USDC below $0.99","tokenSymbol":"USDC","condition":"BELOW","threshold":0.99,"cooldownMin":60}
"Notify me if EURC goes above $1.10" -> {"name":"EURC above $1.10","tokenSymbol":"EURC","condition":"ABOVE","threshold":1.10,"cooldownMin":60}
"Warn me every 30 min when USYC exceeds $1.05" -> {"name":"USYC above $1.05","tokenSymbol":"USYC","condition":"ABOVE","threshold":1.05,"cooldownMin":30}`;

export async function parseNaturalLanguageRule(input: string): Promise<ParsedRule> {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: input }],
  });

  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text?.trim() ?? '';

  // Extract JSON from response (model might wrap in markdown)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse AI response');
  }

  let parsed: ParsedRule;
  try {
    parsed = JSON.parse(jsonMatch[0]) as ParsedRule;
  } catch {
    throw new Error('AI returned invalid JSON, try rephrasing your rule');
  }

  // Validate, accept any non-empty uppercase symbol (all Arc tokens supported)
  if (!parsed.tokenSymbol || typeof parsed.tokenSymbol !== 'string') {
    throw new Error('Invalid token symbol');
  }
  parsed.tokenSymbol = parsed.tokenSymbol.toUpperCase().trim();
  if (!['ABOVE', 'BELOW'].includes(parsed.condition)) {
    throw new Error(`Invalid condition: ${parsed.condition}`);
  }
  if (typeof parsed.threshold !== 'number' || parsed.threshold <= 0) {
    throw new Error('Invalid threshold value');
  }

  return {
    name: parsed.name || `${parsed.tokenSymbol} ${parsed.condition} $${parsed.threshold}`,
    tokenSymbol: parsed.tokenSymbol,
    condition: parsed.condition,
    threshold: parsed.threshold,
    cooldownMin: parsed.cooldownMin || 60,
  };
}
