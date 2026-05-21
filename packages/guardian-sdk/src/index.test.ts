import assert from 'node:assert';
import { test } from 'node:test';
import { createGuardian, evaluate, GuardianPolicy } from './index';

const policy: GuardianPolicy = {
  perTxUsd: 100,
  dailyUsd: 500,
  allowTokens: ['USDC', 'EURC'],
  allowDestinations: ['0xcc63ec9db1d6db278f8b8c77319e40f712d4dd67'],
  approvalThresholdUsd: 50,
  maxSlippageBps: 100,
  allowedActions: ['WITHDRAW', 'SWAP'],
};

test('allows a clean small action', () => {
  const r = evaluate({ ...policy, approvalThresholdUsd: 1000 }, { action: 'WITHDRAW', amountUsd: 10, token: 'USDC', destination: '0xCC63EC9DB1D6DB278F8B8C77319E40F712D4DD67' });
  assert.equal(r.decision, 'ALLOW');
});

test('requires approval above threshold', () => {
  const r = evaluate(policy, { action: 'WITHDRAW', amountUsd: 80, token: 'USDC', destination: '0xcc63ec9db1d6db278f8b8c77319e40f712d4dd67' });
  assert.equal(r.decision, 'REQUIRE_APPROVAL');
});

test('denies over per-tx cap', () => {
  const r = evaluate(policy, { action: 'WITHDRAW', amountUsd: 150, token: 'USDC' });
  assert.equal(r.decision, 'DENY');
  assert.ok(r.violations.some((v) => v.code === 'PER_TX_EXCEEDED'));
});

test('denies over daily cap', () => {
  const r = evaluate(policy, { action: 'WITHDRAW', amountUsd: 60, token: 'USDC', spentTodayUsd: 480 });
  assert.ok(r.violations.some((v) => v.code === 'DAILY_LIMIT_EXCEEDED'));
});

test('denies token not on allow list', () => {
  const r = evaluate(policy, { action: 'SWAP', amountUsd: 10, token: 'SCAM' });
  assert.ok(r.violations.some((v) => v.code === 'TOKEN_NOT_ALLOWED'));
});

test('denies destination not on allow list', () => {
  const r = evaluate(policy, { action: 'WITHDRAW', amountUsd: 10, token: 'USDC', destination: '0x0000000000000000000000000000000000000bad' });
  assert.ok(r.violations.some((v) => v.code === 'DESTINATION_NOT_ALLOWED'));
});

test('denies disallowed action', () => {
  const r = evaluate(policy, { action: 'BRIDGE', amountUsd: 10, token: 'USDC' });
  assert.ok(r.violations.some((v) => v.code === 'ACTION_NOT_ALLOWED'));
});

test('denies slippage over cap', () => {
  const r = evaluate(policy, { action: 'SWAP', amountUsd: 10, token: 'USDC', slippageBps: 300 });
  assert.ok(r.violations.some((v) => v.code === 'SLIPPAGE_TOO_HIGH'));
});

test('createGuardian wraps policy', () => {
  const g = createGuardian({ perTxUsd: 5 });
  assert.equal(g.evaluate({ action: 'WITHDRAW', amountUsd: 10 }).decision, 'DENY');
});
