# @guardagent/guardian

Policy guardrails for autonomous stablecoin agents on **Arc** and **Circle**. Zero dependencies, pure functions, framework-agnostic.

Autonomous agents on Arc can move USDC across chains, swap, bridge, pay, and earn, but Circle's native spending policies are mainnet/Base-only, so on **Arc testnet there is no built-in spending enforcement**. This package is the missing safety layer: evaluate any proposed agent action against a policy and get back `ALLOW`, `DENY`, or `REQUIRE_APPROVAL` with reasons, before the agent touches funds.

It powers GuardAgentAI and is extracted as a public good for any Arc/Circle agent builder.

## Install

```bash
npm install @guardagent/guardian
```

## Usage

```ts
import { createGuardian } from '@guardagent/guardian';

const guardian = createGuardian({
  perTxUsd: 100,
  dailyUsd: 500,
  allowTokens: ['USDC', 'EURC'],
  allowDestinations: ['0xcc63ec9db1d6db278f8b8c77319e40f712d4dd67'],
  approvalThresholdUsd: 1000,
  maxSlippageBps: 100,
  allowedActions: ['WITHDRAW', 'SWAP', 'GATEWAY_SPEND'],
});

const verdict = guardian.evaluate({
  action: 'WITHDRAW',
  amountUsd: 250,
  token: 'USDC',
  destination: '0xcc63ec9db1d6db278f8b8c77319e40f712d4dd67',
  spentTodayUsd: 120,
});

if (verdict.decision === 'DENY') throw new Error(verdict.reasons.join('; '));
if (verdict.decision === 'REQUIRE_APPROVAL') {
  // route to a multi-signer approval queue
}
// ALLOW -> execute the action
```

## Wrap any agent tool

```ts
import { isAllowed, GuardianPolicy, GuardianRequest } from '@guardagent/guardian';

function guarded<T>(policy: GuardianPolicy, req: GuardianRequest, run: () => Promise<T>) {
  if (!isAllowed(policy, req)) throw new Error('Blocked by guardian policy');
  return run();
}
```

Works with any agent runtime (LangChain, OpenAI Agents SDK, Circle Agent Stack, or a plain tool loop) and any wallet (Circle Developer-Controlled Wallets, viem, ethers).

## Policy

| Field | Effect |
|---|---|
| `perTxUsd` | Deny if a single action exceeds this USD amount |
| `dailyUsd` | Deny if `spentTodayUsd + amountUsd` exceeds this |
| `allowTokens` | If set, only these token symbols are allowed |
| `denyTokens` | Always deny these token symbols |
| `allowDestinations` | If set, only these destination addresses are allowed |
| `approvalThresholdUsd` | Above this amount, return `REQUIRE_APPROVAL` |
| `maxSlippageBps` | Deny if `slippageBps` exceeds this |
| `allowedActions` | If set, only these action types are allowed |

## Decision model

`evaluate()` collects all hard violations first. Any violation → `DENY` (with every reason). Otherwise, if the amount is above `approvalThresholdUsd` → `REQUIRE_APPROVAL`. Otherwise → `ALLOW`.

## License

MIT
