export type GuardianAction =
  | 'WITHDRAW'
  | 'SWAP'
  | 'BRIDGE'
  | 'GATEWAY_SPEND'
  | 'TRANSFER'
  | 'NANOPAY';

export type GuardianDecision = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export type ViolationCode =
  | 'ACTION_NOT_ALLOWED'
  | 'TOKEN_DENIED'
  | 'TOKEN_NOT_ALLOWED'
  | 'DESTINATION_NOT_ALLOWED'
  | 'SLIPPAGE_TOO_HIGH'
  | 'PER_TX_EXCEEDED'
  | 'DAILY_LIMIT_EXCEEDED';

export interface GuardianPolicy {
  perTxUsd?: number;
  dailyUsd?: number;
  allowTokens?: string[];
  denyTokens?: string[];
  allowDestinations?: string[];
  approvalThresholdUsd?: number;
  maxSlippageBps?: number;
  allowedActions?: GuardianAction[];
}

export interface GuardianRequest {
  action: GuardianAction;
  amountUsd: number;
  token?: string;
  destination?: string;
  slippageBps?: number;
  spentTodayUsd?: number;
}

export interface Violation {
  code: ViolationCode;
  message: string;
}

export interface GuardianResult {
  decision: GuardianDecision;
  reasons: string[];
  violations: Violation[];
}

function norm(s?: string): string | undefined {
  return s === undefined ? undefined : s.trim();
}

export function evaluate(policy: GuardianPolicy, request: GuardianRequest): GuardianResult {
  const violations: Violation[] = [];
  const token = norm(request.token)?.toUpperCase();
  const destination = norm(request.destination)?.toLowerCase();
  const amountUsd = Number(request.amountUsd) || 0;
  const spentToday = Number(request.spentTodayUsd) || 0;

  if (policy.allowedActions && policy.allowedActions.length > 0 && !policy.allowedActions.includes(request.action)) {
    violations.push({ code: 'ACTION_NOT_ALLOWED', message: `Action ${request.action} is not permitted by policy` });
  }

  if (token && policy.denyTokens && policy.denyTokens.map((t) => t.toUpperCase()).includes(token)) {
    violations.push({ code: 'TOKEN_DENIED', message: `Token ${token} is on the deny list` });
  }

  if (token && policy.allowTokens && policy.allowTokens.length > 0 && !policy.allowTokens.map((t) => t.toUpperCase()).includes(token)) {
    violations.push({ code: 'TOKEN_NOT_ALLOWED', message: `Token ${token} is not on the allow list` });
  }

  if (destination && policy.allowDestinations && policy.allowDestinations.length > 0 && !policy.allowDestinations.map((d) => d.toLowerCase()).includes(destination)) {
    violations.push({ code: 'DESTINATION_NOT_ALLOWED', message: `Destination ${destination} is not on the allow list` });
  }

  if (policy.maxSlippageBps !== undefined && request.slippageBps !== undefined && request.slippageBps > policy.maxSlippageBps) {
    violations.push({ code: 'SLIPPAGE_TOO_HIGH', message: `Slippage ${request.slippageBps}bps exceeds max ${policy.maxSlippageBps}bps` });
  }

  if (policy.perTxUsd !== undefined && amountUsd > policy.perTxUsd) {
    violations.push({ code: 'PER_TX_EXCEEDED', message: `Amount $${amountUsd} exceeds per-transaction cap $${policy.perTxUsd}` });
  }

  if (policy.dailyUsd !== undefined && spentToday + amountUsd > policy.dailyUsd) {
    violations.push({ code: 'DAILY_LIMIT_EXCEEDED', message: `Amount $${amountUsd} would exceed the daily cap $${policy.dailyUsd} (already spent $${spentToday})` });
  }

  if (violations.length > 0) {
    return { decision: 'DENY', reasons: violations.map((v) => v.message), violations };
  }

  if (policy.approvalThresholdUsd !== undefined && amountUsd > policy.approvalThresholdUsd) {
    return {
      decision: 'REQUIRE_APPROVAL',
      reasons: [`Amount $${amountUsd} is above the approval threshold $${policy.approvalThresholdUsd} and needs a second signer`],
      violations: [],
    };
  }

  return { decision: 'ALLOW', reasons: ['Within policy'], violations: [] };
}

export interface Guardian {
  policy: GuardianPolicy;
  evaluate: (request: GuardianRequest) => GuardianResult;
}

export function createGuardian(policy: GuardianPolicy): Guardian {
  return {
    policy,
    evaluate: (request: GuardianRequest) => evaluate(policy, request),
  };
}

export function isAllowed(policy: GuardianPolicy, request: GuardianRequest): boolean {
  return evaluate(policy, request).decision === 'ALLOW';
}
