import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { verifyAgentId } from '../services/arcIdentity';
import { summarizeAgentReputation, listAgentFeedback } from '../services/arcReputation';

export const agentsRouter = Router();

const IDENTITY_REGISTRY   = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713';
const VALIDATION_REGISTRY = '0x8004Cb1BF31DAf7788923b405b754f57acEB4272';

const agentIdSchema = z.object({ id: z.string().regex(/^\d+$/, 'id must be a positive integer') });

/**
 * Public profile of an ERC-8004 agent by token id.
 * Combines on-chain identity (owner + tokenURI) with off-chain
 * reputation summary + recent feedback events.
 */
agentsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const parsed = agentIdSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid agent id' });
    return;
  }
  const agentId = parsed.data.id;

  const maxFeedback = Math.min(parseInt(String(req.query.feedback ?? '20'), 10) || 20, 50);

  try {
    const [identity, reputation, feedbackList] = await Promise.allSettled([
      verifyAgentId(BigInt(agentId)),
      summarizeAgentReputation(agentId),
      listAgentFeedback(agentId, maxFeedback),
    ]);

    const identityOk = identity.status === 'fulfilled' ? identity.value : { owner: null, tokenURI: null };
    if (!identityOk.owner) {
      res.status(404).json({ error: `Agent ${agentId} not found in IdentityRegistry` });
      return;
    }

    res.json({
      agentId,
      registries: {
        identity: IDENTITY_REGISTRY,
        reputation: REPUTATION_REGISTRY,
        validation: VALIDATION_REGISTRY,
        chainId: 5042002,
      },
      identity: identityOk,
      reputation: reputation.status === 'fulfilled'
        ? reputation.value
        : { agentId, count: 0, averageScore: null, minScore: null, maxScore: null, lastFeedbackAt: null, tagCounts: {} },
      feedback: feedbackList.status === 'fulfilled'
        ? feedbackList.value
        : [],
      errors: {
        identity: identity.status === 'rejected' ? String((identity as PromiseRejectedResult).reason?.message ?? identity.reason) : null,
        reputation: reputation.status === 'rejected' ? String((reputation as PromiseRejectedResult).reason?.message ?? reputation.reason) : null,
        feedback: feedbackList.status === 'rejected' ? String((feedbackList as PromiseRejectedResult).reason?.message ?? feedbackList.reason) : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Lookup failed' });
  }
});
