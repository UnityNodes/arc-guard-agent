import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
  defaultHeaders: {
    'HTTP-Referer': 'https://guardagent.xyz',
    'X-Title': 'GuardAgent',
  },
});

export async function getAiInsight(
  tokenSymbol: string,
  condition: string,
  threshold: number,
  currentPrice: number
): Promise<string | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;

  try {
    const conditionLabel = condition === 'ABOVE' ? 'above' : 'below';
    const diffPct = (Math.abs(currentPrice - threshold) / threshold * 100).toFixed(1);
    const direction = condition === 'ABOVE' ? 'breakout above' : 'drop below';

    const completion = await client.chat.completions.create({
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      messages: [
        {
          role: 'system',
          content: 'You are a concise crypto market analyst. Give 1 sentence of market context and 1 actionable recommendation. No disclaimers. No emojis. Plain text only.',
        },
        {
          role: 'user',
          content: `${tokenSymbol} just had a ${direction} $${threshold.toLocaleString()} (now $${currentPrice.toLocaleString()}, ${diffPct}% away). What happened and what should the trader consider doing?`,
        },
      ],
      max_tokens: 120,
      temperature: 0.5,
    });

    return completion.choices[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    console.error('AI insight error:', err);
    return null;
  }
}
