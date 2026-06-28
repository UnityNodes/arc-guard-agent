'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { TokenMark } from '@/components/Atoms';
import { IconPlus, IconClose, IconShield, IconCheck, IconAlert } from '@/components/Icons';
import { api } from '@/lib/api';
import { useBackendAuth } from '@/hooks/useBackendAuth';
import { useToast } from '@/components/ui/toast';

interface Policy {
  perTxUsd?: number;
  dailyUsd?: number;
  approvalThresholdUsd?: number;
  allowTokens?: string[];
  denyTokens?: string[];
}
interface EvalResult {
  decision: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
  reasons: string[];
}

const TOKENS = ['USDC', 'EURC'];
const ACTIONS = [
  { value: 'WITHDRAW',      label: 'Send / Withdraw',       hint: 'Move USDC or EURC to an external address' },
  { value: 'SWAP',          label: 'Swap',                  hint: 'Convert between USDC and EURC on Arc' },
  { value: 'TRANSFER',      label: 'Transfer',              hint: 'Internal transfer between accounts' },
  { value: 'BRIDGE',        label: 'Bridge (CCTP)',         hint: 'Move USDC across chains via Circle CCTP' },
  { value: 'GATEWAY_SPEND', label: 'Gateway spend',         hint: 'Spend from Circle Gateway unified balance' },
] as const;
const EVAL_TOKENS = [
  { value: 'USDC',      label: 'USDC' },
  { value: 'EURC',      label: 'EURC' },
  { value: 'SCAMTOKEN', label: 'SCAMTOKEN (test)' },
];

type ActionEnum = typeof ACTIONS[number]['value'];

export default function GuardianPage() {
  const { ready } = useBackendAuth();
  const toast = useToast();

  // Policy state
  const [txLimit, setTxLimit] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');
  const [approvalThreshold, setApprovalThreshold] = useState('');
  const [allowedTokens, setAllowedTokens] = useState<string[]>([]);
  const [blockedTokens, setBlockedTokens] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  // Evaluator state
  const [evalAction, setEvalAction] = useState<ActionEnum>('WITHDRAW');
  const [evalAmount, setEvalAmount] = useState('50');
  const [evalToken, setEvalToken] = useState('USDC');
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [recentEvals, setRecentEvals] = useState<Array<{ action: string; amount: string; token: string; decision: EvalResult['decision']; ts: number }>>([]);

  const txDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dailyDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threshDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      const [walletRes, policyRes] = await Promise.all([
        api.get<{ wallet: { maxTxSizeUsd: number; dailyLimitUsd: number; allowedTokens: string[]; blockedTokens: string[] } | null }>('/agent-wallet'),
        api.get<{ policy: Policy }>('/guardian/policy').catch(() => ({ policy: {} })),
      ]);
      const w = walletRes.wallet;
      if (w) {
        setTxLimit(String(w.maxTxSizeUsd ?? ''));
        setDailyLimit(String(w.dailyLimitUsd ?? ''));
        setAllowedTokens(w.allowedTokens ?? []);
        setBlockedTokens(w.blockedTokens ?? []);
      }
      const p = policyRes.policy as Policy;
      if (p.approvalThresholdUsd != null) setApprovalThreshold(String(p.approvalThresholdUsd));
    } catch { /* ignore */ }
  }, [ready]);

  useEffect(() => { load(); }, [load]);

  function flashSaved() { setSaved(true); setTimeout(() => setSaved(false), 1600); }
  function patchLimits(patch: Record<string, unknown>) {
    api.put('/agent-wallet/limits', patch)
      .then(flashSaved)
      .catch((err) => toast.error('Could not save policy', err instanceof Error ? err.message : 'Try again'));
  }

  function handleTxLimit(val: string) {
    setTxLimit(val);
    if (txDebounce.current) clearTimeout(txDebounce.current);
    txDebounce.current = setTimeout(() => {
      const n = parseFloat(val);
      if (!isNaN(n) && n > 0) patchLimits({ maxTxSizeUsd: n });
    }, 700);
  }
  function handleDailyLimit(val: string) {
    setDailyLimit(val);
    if (dailyDebounce.current) clearTimeout(dailyDebounce.current);
    dailyDebounce.current = setTimeout(() => {
      const n = parseFloat(val);
      if (!isNaN(n) && n > 0) patchLimits({ dailyLimitUsd: n });
    }, 700);
  }
  function handleApprovalThreshold(val: string) {
    setApprovalThreshold(val);
    if (threshDebounce.current) clearTimeout(threshDebounce.current);
    threshDebounce.current = setTimeout(() => {
      const n = parseFloat(val);
      if (!isNaN(n) && n > 0) patchLimits({ approvalThresholdUsd: n });
    }, 700);
  }
  function addToken(t: string) {
    if (allowedTokens.includes(t)) { setAddOpen(false); return; }
    const next = [...allowedTokens, t];
    setAllowedTokens(next); setAddOpen(false);
    patchLimits({ allowedTokens: next });
  }
  function removeToken(t: string) {
    const next = allowedTokens.filter(x => x !== t);
    setAllowedTokens(next);
    patchLimits({ allowedTokens: next });
  }
  function addBlocked(t: string) {
    if (blockedTokens.includes(t)) { setBlockOpen(false); return; }
    const next = [...blockedTokens, t];
    setBlockedTokens(next); setBlockOpen(false);
    api.put('/agent-wallet/blocked-tokens', { blockedTokens: next })
      .then(flashSaved)
      .catch((err) => toast.error('Could not save block-list', err instanceof Error ? err.message : 'Try again'));
  }
  function removeBlocked(t: string) {
    const next = blockedTokens.filter(x => x !== t);
    setBlockedTokens(next);
    api.put('/agent-wallet/blocked-tokens', { blockedTokens: next })
      .then(flashSaved)
      .catch((err) => toast.error('Could not save block-list', err instanceof Error ? err.message : 'Try again'));
  }

  async function runEval() {
    setEvalLoading(true);
    setEvalResult(null);
    try {
      const d = await api.post<{ result: EvalResult }>('/guardian/evaluate', {
        action: evalAction,
        amountUsd: parseFloat(evalAmount) || 0,
        token: evalToken,
      });
      setEvalResult(d.result);
      setRecentEvals(prev => [
        { action: evalAction, amount: evalAmount, token: evalToken, decision: d.result.decision, ts: Date.now() },
        ...prev,
      ].slice(0, 5));
    } catch (e) {
      setEvalResult({ decision: 'DENY', reasons: [e instanceof Error ? e.message : 'Request failed'] });
    } finally {
      setEvalLoading(false);
    }
  }

  const txN = parseFloat(txLimit) || 0;
  const dailyN = parseFloat(dailyLimit) || 0;
  const threshN = parseFloat(approvalThreshold) || 0;
  const perTxOfDailyPct = dailyN > 0 ? Math.min(100, (txN / dailyN) * 100) : 0;
  const threshOfTxPct = txN > 0 ? Math.min(100, (threshN / txN) * 100) : 0;

  return (
    <div className="arc-page">

      {/* 2-col grid: policy editor (left, wider) + dry-run console (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16, alignItems: 'start' }}>

        {/* LEFT: Policy editor */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Spending limits */}
          <div className="arc-card">
            <div className="arc-card-head">
              <span className="arc-card-title"><IconShield size={13}/> Spending limits</span>
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>auto-saves</span>
            </div>
            <div style={{ padding: '0 18px' }}>
            <PolicyEditRow
              label="Per-transaction cap"
              hint="Max USD value the agent can move in a single action."
              value={txLimit}
              onChange={handleTxLimit}
              placeholder="100"
              progressPct={null}
              progressLabel={null}
            />

            <PolicyEditRow
              label="Daily limit"
              hint="Max USD the agent can move in 24 hours."
              value={dailyLimit}
              onChange={handleDailyLimit}
              placeholder="500"
              progressPct={perTxOfDailyPct}
              progressLabel={txN && dailyN ? `per-tx is ${Math.round(perTxOfDailyPct)}% of daily` : null}
            />

            <PolicyEditRow
              label="Telegram approval above"
              hint="Anything above this amount needs a tap on Telegram before executing."
              value={approvalThreshold}
              onChange={handleApprovalThreshold}
              placeholder="not set"
              progressPct={threshOfTxPct}
              progressLabel={txN && threshN ? `${Math.round(threshOfTxPct)}% of per-tx cap` : null}
            />
            </div>
          </div>

          {/* Allowed assets */}
          <div className="arc-card">
            <div className="arc-card-head">
              <span className="arc-card-title">Allowed assets</span>
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>token allow/block list</span>
            </div>
            <div style={{ padding: '0 18px' }}>

            {/* Allowed tokens */}
            <div style={{ padding: '12px 0', borderBottom: '1px solid var(--line-1)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)', marginBottom: 2 }}>Allowed tokens</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Agent can only transact with these tokens. Empty = any token allowed.</div>
                </div>
                <TokenAddDropdown
                  available={TOKENS.filter(t => !allowedTokens.includes(t))}
                  open={addOpen}
                  setOpen={setAddOpen}
                  onPick={addToken}
                  label="Allow"
                />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {allowedTokens.length === 0 && (
                  <span style={{ fontSize: 11.5, color: 'var(--ink-3)', fontStyle: 'italic' }}>any · no restriction</span>
                )}
                {allowedTokens.map(t => (
                  <span key={t} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 500,
                    background: 'var(--ok-soft)', color: 'var(--ok)',
                    border: '1px solid rgba(26,127,75,0.30)', borderRadius: 5, padding: '3px 8px',
                  }}>
                    <TokenMark symbol={t} size={12} /> {t}
                    <button
                      onClick={() => removeToken(t)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--ok)', display: 'flex', alignItems: 'center' }}
                      title="Remove"
                    >
                      <IconClose size={9} />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Blocked tokens */}
            <div style={{ paddingTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)', marginBottom: 2 }}>Blocked tokens</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Agent will never interact with these. Overrides the allow list.</div>
                </div>
                <TokenAddDropdown
                  available={TOKENS.filter(t => !blockedTokens.includes(t))}
                  open={blockOpen}
                  setOpen={setBlockOpen}
                  onPick={addBlocked}
                  label="Block"
                />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {blockedTokens.length === 0 && (
                  <span style={{ fontSize: 11.5, color: 'var(--ink-3)', fontStyle: 'italic' }}>none blocked</span>
                )}
                {blockedTokens.map(t => (
                  <span key={t} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 500,
                    background: 'var(--err-soft)', color: 'var(--err)',
                    border: '1px solid rgba(185,28,28,0.30)', borderRadius: 5, padding: '3px 8px',
                  }}>
                    <TokenMark symbol={t} size={12} /> {t}
                    <button
                      onClick={() => removeBlocked(t)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--err)', display: 'flex', alignItems: 'center' }}
                      title="Remove"
                    >
                      <IconClose size={9} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Dry-run console */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div className="arc-card">
            <div className="arc-card-head">
              <span className="arc-card-title">
                <IconAlert size={13} /> Dry-run console
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>no funds move</span>
            </div>

            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              Type an action below and Guardian will tell you exactly what it would decide right now.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Action</span>
                <select
                  className="arc-select"
                  value={evalAction}
                  onChange={e => setEvalAction(e.target.value as ActionEnum)}
                >
                  {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Amount (USD)</span>
                <input
                  className="arc-input"
                  style={{ fontFamily: 'var(--font-mono, monospace)' }}
                  placeholder="50"
                  value={evalAmount}
                  onChange={e => setEvalAmount(e.target.value)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Token</span>
                <select
                  className="arc-select"
                  value={evalToken}
                  onChange={e => setEvalToken(e.target.value)}
                >
                  {EVAL_TOKENS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
            </div>

            {ACTIONS.find(a => a.value === evalAction)?.hint && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-3)', fontStyle: 'italic' }}>
                {ACTIONS.find(a => a.value === evalAction)?.hint}
              </div>
            )}

            <button
              className="arc-btn arc-btn-primary"
              style={{ marginTop: 14, width: '100%', justifyContent: 'center' }}
              onClick={runEval}
              disabled={evalLoading}
            >
              {evalLoading ? 'Evaluating...' : 'Evaluate against policy'}
            </button>

            {evalResult && (
              <div style={{
                marginTop: 14, padding: '10px 12px', borderRadius: 7,
                background: evalResult.decision === 'ALLOW'
                  ? 'var(--ok-soft)'
                  : evalResult.decision === 'DENY'
                  ? 'var(--err-soft)'
                  : 'var(--warn-soft)',
                border: '1px solid',
                borderColor: evalResult.decision === 'ALLOW'
                  ? 'rgba(26,127,75,0.30)'
                  : evalResult.decision === 'DENY'
                  ? 'rgba(185,28,28,0.30)'
                  : 'rgba(180,83,9,0.30)',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
                  fontSize: 12.5, fontWeight: 600,
                  color: evalResult.decision === 'ALLOW'
                    ? 'var(--ok)'
                    : evalResult.decision === 'DENY'
                    ? 'var(--err)'
                    : 'var(--warn)',
                }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: evalResult.decision === 'ALLOW'
                      ? 'var(--ok)'
                      : evalResult.decision === 'DENY'
                      ? 'var(--err)'
                      : 'var(--warn)',
                  }} />
                  {decisionLabel(evalResult.decision)}
                </div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }}>
                  {evalResult.reasons.length === 0 ? (
                    <li>Within all configured limits and rules.</li>
                  ) : evalResult.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
            </div>
          </div>

          {recentEvals.length > 0 && (
            <div className="arc-card">
              <div className="arc-card-head">
                <span className="arc-card-title">Recent dry-runs</span>
                <button className="arc-link-btn" onClick={() => setRecentEvals([])}>Clear</button>
              </div>
              <div className="arc-table-wrap">
                <table className="arc-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Amount</th>
                      <th>Token</th>
                      <th>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentEvals.map((e, i) => (
                      <tr key={i}>
                        <td>{actionLabel(e.action)}</td>
                        <td style={{ fontFamily: 'var(--font-mono, monospace)' }}>${e.amount}</td>
                        <td>{e.token}</td>
                        <td>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 500,
                            color: e.decision === 'ALLOW' ? 'var(--ok)' : e.decision === 'DENY' ? 'var(--err)' : 'var(--warn)',
                          }}>
                            <span style={{
                              width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                              background: e.decision === 'ALLOW' ? 'var(--ok)' : e.decision === 'DENY' ? 'var(--err)' : 'var(--warn)',
                            }} />
                            {decisionLabel(e.decision)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Label helpers
function actionLabel(raw: string): string {
  return ACTIONS.find(a => a.value === raw)?.label ?? raw;
}
function decisionLabel(d: EvalResult['decision']): string {
  if (d === 'ALLOW') return 'Allow';
  if (d === 'DENY') return 'Deny';
  return 'Needs approval';
}

// Sub-components
function PolicyEditRow({
  label, hint, value, onChange, placeholder, progressPct, progressLabel,
}: {
  label: string; hint: string; value: string; onChange: (v: string) => void;
  placeholder: string; progressPct: number | null; progressLabel: string | null;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 16, padding: '12px 0', borderBottom: '1px solid var(--line-1)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{hint}</div>
        {progressPct !== null && progressLabel && (
          <div style={{ marginTop: 6 }}>
            <div style={{ height: 3, background: 'var(--bg-4)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, background: 'var(--warn)', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 3 }}>{progressLabel}</div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>$</span>
        <input
          className="arc-input"
          style={{ width: 90, fontFamily: 'var(--font-mono, monospace)', textAlign: 'right' }}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}

function TokenAddDropdown({
  available, open, setOpen, onPick, label,
}: {
  available: string[]; open: boolean; setOpen: (o: boolean) => void;
  onPick: (t: string) => void; label: string;
}) {
  if (available.length === 0) return null;
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        className="arc-btn arc-btn-secondary"
        style={{ fontSize: 11.5, padding: '4px 10px', gap: 4 }}
        onClick={() => setOpen(!open)}
      >
        <IconPlus size={10} /> {label}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20,
          background: 'var(--bg-3)', border: '1px solid var(--line-1)',
          borderRadius: 7, boxShadow: '0 4px 16px rgba(0,0,0,0.18)', minWidth: 110, overflow: 'hidden',
        }}>
          {available.map(t => (
            <button
              key={t}
              onClick={() => onPick(t)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '8px 12px',
                background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: 'var(--ink-1)',
                textAlign: 'left',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-4)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <TokenMark symbol={t} size={14} /> {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
