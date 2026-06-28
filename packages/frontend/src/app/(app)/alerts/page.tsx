'use client';
import React, { useState, useEffect } from 'react';
import { TokenMark } from '@/components/Atoms';
import {
  IconPlus, IconShield, IconFx, IconZap, IconBell,
  IconClose, IconPause, IconSparkle,
} from '@/components/Icons';
import { useBackendAuth } from '@/hooks/useBackendAuth';
import { api } from '@/lib/api';

interface Alert {
  id: string;
  name: string;
  tokenSymbol: string;
  condition: string;
  threshold: number;
  isActive: boolean;
  createdAt: string;
  action?: 'ALERT' | 'BRIDGE';
  triggerType?: 'PRICE' | 'BALANCE_USDC_GTE';
  actionConfig?: { toChain?: string; amountUsdc?: string } | null;
}

type AlertActionId = 'notify' | 'bridge';
type AlertAction = {
  id: AlertActionId;
  label: string;
  icon: React.FC<{ size?: number }>;
  tone: 'amber' | 'info' | 'warn' | 'ok';
  apiAction: 'ALERT' | 'BRIDGE';
};
const ALERT_ACTIONS: AlertAction[] = [
  { id: 'notify', label: 'Notify me',         icon: IconBell, tone: 'amber', apiAction: 'ALERT'  },
  { id: 'bridge', label: 'Auto-bridge USDC',  icon: IconFx,   tone: 'info',  apiAction: 'BRIDGE' },
];

type ConditionOption = {
  value: string;
  label: string;
  apiCondition: 'ABOVE' | 'BELOW';
  triggerType: 'PRICE' | 'BALANCE_USDC_GTE';
  actionLock: AlertActionId;
};
const CONDITION_OPTIONS: ConditionOption[] = [
  { value: 'price above',    label: 'price above',     apiCondition: 'ABOVE', triggerType: 'PRICE',             actionLock: 'notify' },
  { value: 'price below',    label: 'price below',     apiCondition: 'BELOW', triggerType: 'PRICE',             actionLock: 'notify' },
  { value: 'balance reaches', label: 'balance reaches', apiCondition: 'ABOVE', triggerType: 'BALANCE_USDC_GTE', actionLock: 'bridge' },
];

const BRIDGE_CHAINS: Array<{ key: string; label: string }> = [
  { key: 'base-sepolia',     label: 'Base Sepolia' },
  { key: 'ethereum-sepolia', label: 'Ethereum Sepolia' },
];

function ruleExpression(a: Alert): { lead: string; op: string; val: string } {
  const trig = a.triggerType ?? 'PRICE';
  const cond = (a.condition || 'BELOW').toUpperCase();
  if (trig === 'BALANCE_USDC_GTE') {
    return { lead: `${a.tokenSymbol} balance`, op: '>=', val: `$${a.threshold}` };
  }
  const op = cond === 'ABOVE' ? '>' : '<';
  return { lead: `${a.tokenSymbol} price`, op, val: `$${a.threshold}` };
}

function ruleActionLabel(a: Alert): { label: string; tone: 'amber' | 'info' } {
  if (a.action === 'BRIDGE') {
    const cfg = a.actionConfig ?? {};
    const dest = BRIDGE_CHAINS.find(c => c.key === cfg.toChain)?.label?.split(' ')[0] ?? 'Base';
    const amt = cfg.amountUsdc ? `$${cfg.amountUsdc} ` : '';
    return { label: `Bridge ${amt}-> ${dest}`, tone: 'info' };
  }
  return { label: 'Notify me', tone: 'amber' };
}

type Prefill = {
  symbol: string;
  condition: string;
  value: string;
  action: AlertActionId;
  toChain?: string;
  bridgeAmount?: string;
};

// ─── Create form ──────────────────────────────────────────────────────────────
function CreateAlertCard({ onClose, onCreated, prefill }: { onClose: () => void; onCreated: () => void; prefill?: Prefill }) {
  const [symbol, setSymbol] = useState(prefill?.symbol ?? 'USDC');
  const [condition, setCondition] = useState(prefill?.condition ?? 'price below');
  const [value, setValue] = useState(prefill?.value ?? '0.99');
  const [action, setAction] = useState<AlertActionId>(prefill?.action ?? 'notify');
  const [toChain, setToChain] = useState(prefill?.toChain ?? 'base-sepolia');
  const [bridgeAmount, setBridgeAmount] = useState(prefill?.bridgeAmount ?? '50');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleActionChange(next: AlertActionId) {
    setAction(next);
    const compatible = CONDITION_OPTIONS.find(c => c.actionLock === next);
    if (compatible && !CONDITION_OPTIONS.find(c => c.value === condition && c.actionLock === next)) {
      setCondition(compatible.value);
      if (next === 'bridge') setValue('50');
      if (next === 'notify') setValue('0.99');
    }
  }
  function handleConditionChange(next: string) {
    setCondition(next);
    const matched = CONDITION_OPTIONS.find(c => c.value === next);
    if (matched && matched.actionLock !== action) setAction(matched.actionLock);
  }

  const availableConditions = CONDITION_OPTIONS.filter(c => c.actionLock === action);
  const isBridge = action === 'bridge';

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const condMeta = CONDITION_OPTIONS.find(c => c.value === condition) ?? CONDITION_OPTIONS[0];
      const actMeta = ALERT_ACTIONS.find(a => a.id === action) ?? ALERT_ACTIONS[0];

      const body: Record<string, unknown> = {
        name: isBridge
          ? `Auto-bridge ${bridgeAmount} USDC -> ${BRIDGE_CHAINS.find(c => c.key === toChain)?.label ?? toChain}`
          : `${symbol} ${condition} ${value}`,
        token: symbol,
        tokenSymbol: symbol,
        condition: condMeta.apiCondition,
        threshold: parseFloat(value),
        cooldownMin: 60,
        action: actMeta.apiAction,
        triggerType: condMeta.triggerType,
      };
      if (isBridge) {
        body.actionConfig = { toChain, amountUsdc: bridgeAmount };
      }

      await api.post('/rules', body);
      onCreated();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create watcher';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const previewActionLabel = isBridge
    ? `Bridge $${bridgeAmount || '?'} -> ${BRIDGE_CHAINS.find(c => c.key === toChain)?.label?.split(' ')[0] ?? '?'}`
    : 'Notify me';

  return (
    <div className="arc-card arc-card-glow" style={{ marginBottom: 14 }}>
      <div className="arc-card-head">
        <span className="arc-card-title"><IconShield size={13}/> Arm a new watcher</span>
        <button className="arc-link-btn" onClick={onClose}><IconClose size={13}/></button>
      </div>

      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Asset</span>
            <select className="ga-input ga-select" value={symbol} onChange={e => setSymbol(e.target.value)}>
              <option>USDC</option>
              <option>EURC</option>
              <option>EURC/USDC</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Condition</span>
            <select className="ga-input ga-select" value={condition} onChange={e => handleConditionChange(e.target.value)}>
              {availableConditions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {isBridge ? 'Balance threshold (USDC)' : 'Threshold'}
            </span>
            <input className="ga-input ga-input-mono" placeholder={isBridge ? '50' : '0.99'} value={value} onChange={e => setValue(e.target.value)}/>
          </label>
        </div>

        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>When triggered, do this</div>
          <div className="ga-alert-action-chips">
            {ALERT_ACTIONS.map(a => {
              const Icon = a.icon;
              const isActive = action === a.id;
              return (
                <button
                  key={a.id}
                  className={`ga-alert-action-chip${isActive ? ' is-active' : ''}`}
                  data-tone={a.tone}
                  onClick={() => handleActionChange(a.id)}
                >
                  <Icon size={12}/> {a.label}
                </button>
              );
            })}
          </div>
        </div>

        {isBridge && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>To chain</span>
              <select className="ga-input ga-select" value={toChain} onChange={e => setToChain(e.target.value)}>
                {BRIDGE_CHAINS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Amount to bridge (USDC)</span>
              <input className="ga-input ga-input-mono" placeholder="50" value={bridgeAmount} onChange={e => setBridgeAmount(e.target.value)}/>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Route</span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: '32px' }}>Arc Testnet {'->'} {BRIDGE_CHAINS.find(c => c.key === toChain)?.label} via CCTP</span>
            </div>
          </div>
        )}

        <div style={{ background: 'var(--bg-3)', border: '1px solid var(--line-1)', borderRadius: 6, padding: '8px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Preview</div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
            When <span style={{ color: 'var(--ink-1)' }}>{symbol}</span>{' '}
            <span style={{ color: 'var(--amber-300)' }}>{condition}</span>{' '}
            <span style={{ color: 'var(--ink-1)' }}>${value || '?'}</span>{' '}
            <span style={{ color: 'var(--ink-3)' }}>-&gt;</span>{' '}
            <span style={{ color: 'var(--ok)' }}>{previewActionLabel}</span>
          </div>
        </div>

        {error && <div style={{ fontSize: 12, color: 'var(--err)' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="arc-btn arc-btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !value || (isBridge && !bridgeAmount)}
          >
            <IconShield size={13}/> {submitting ? 'Arming...' : 'Arm watcher'}
          </button>
          <button className="arc-btn arc-btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Template chip ────────────────────────────────────────────────────────────
function TemplateChip({ title, desc, example, Icon, onClick }: { title: string; desc: string; example: string; Icon: React.FC<{ size?: number }>; onClick: () => void }) {
  return (
    <button className="ga-template-chip" onClick={onClick}>
      <div className="ga-template-chip-head">
        <span className="ga-template-chip-icon"><Icon size={13}/></span>
        <span className="ga-template-chip-title">{title}</span>
      </div>
      <div className="ga-template-chip-desc">{desc}</div>
      <div className="ga-template-chip-example">{example}</div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AlertsPage() {
  const { ready } = useBackendAuth();
  const [filter, setFilter] = useState<'all' | 'armed' | 'paused'>('all');
  const [creating, setCreating] = useState(false);
  const [prefill, setPrefill] = useState<Prefill | undefined>(undefined);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  function openWithPrefill(p: Prefill) {
    setPrefill(p);
    setCreating(true);
  }
  function closeCreate() {
    setCreating(false);
    setPrefill(undefined);
  }

  async function loadAlerts() {
    try {
      const res = await api.get<{ rules: Alert[] }>('/rules');
      setAlerts(res.rules ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    loadAlerts();
  }, [ready]);

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this watcher? This cannot be undone.')) return;
    await api.delete(`/rules/${id}`);
    setAlerts(prev => prev.filter(a => a.id !== id));
  }

  async function handleToggle(a: Alert) {
    try {
      await api.post(`/rules/${a.id}/toggle`, {});
      setAlerts(prev => prev.map(r => r.id === a.id ? { ...r, isActive: !r.isActive } : r));
    } catch { /* ignore */ }
  }

  const armed = alerts.filter(a => a.isActive);
  const paused = alerts.filter(a => !a.isActive);
  const filtered = filter === 'all' ? alerts : filter === 'armed' ? armed : paused;

  return (
    <div className="arc-page">

      {/* KPI strip as tab-bar */}
      <div className="arc-tab-bar" style={{ marginBottom: 14 }}>
        <button
          className={`arc-tab${filter === 'all' ? ' arc-tab-active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All watchers <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>{alerts.length}</span>
        </button>
        <button
          className={`arc-tab${filter === 'armed' ? ' arc-tab-active' : ''}`}
          onClick={() => setFilter('armed')}
        >
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', marginRight: 5, verticalAlign: 'middle' }}/>
          Armed <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>{armed.length}</span>
        </button>
        <button
          className={`arc-tab${filter === 'paused' ? ' arc-tab-active' : ''}`}
          onClick={() => setFilter('paused')}
        >
          Paused <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>{paused.length}</span>
        </button>
      </div>

      {creating && (
        <CreateAlertCard
          key={prefill ? `pf-${prefill.action}-${prefill.condition}-${prefill.value}` : 'blank'}
          prefill={prefill}
          onClose={closeCreate}
          onCreated={loadAlerts}
        />
      )}

      {/* Watchers list */}
      <div className="arc-card" style={{ marginBottom: 14 }}>
        <div className="arc-card-head">
          <span className="arc-card-title">
            <IconBell size={13}/>
            {' '}{filter === 'all' ? 'All watchers' : filter === 'armed' ? 'Armed watchers' : 'Paused watchers'}
            <span style={{ fontSize: 10, color: 'var(--ink-3)', marginLeft: 8, fontWeight: 400 }}>worker checks every 60s</span>
          </span>
          <button
            className="arc-btn arc-btn-primary"
            onClick={() => creating ? closeCreate() : setCreating(true)}
          >
            {creating ? <><IconClose size={11}/> Close</> : <><IconPlus size={11}/> New watcher</>}
          </button>
        </div>

        {loading ? (
          <div className="arc-empty">Loading watchers...</div>
        ) : filtered.length === 0 ? (
          <div className="arc-empty">
            {filter === 'all'
              ? 'No watchers armed. Click "New watcher" or use a quick template below.'
              : filter === 'armed'
              ? 'None of your watchers are armed right now.'
              : 'No paused watchers.'}
          </div>
        ) : (
          <div className="arc-table-wrap">
            <table className="arc-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Asset</th>
                  <th>Condition</th>
                  <th>Action</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const expr = ruleExpression(a);
                  const actionInfo = ruleActionLabel(a);
                  return (
                    <tr key={a.id}>
                      <td>
                        <button
                          className="arc-link-btn"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                          onClick={() => handleToggle(a)}
                          title={a.isActive ? 'Armed. Click to pause' : 'Paused. Click to arm'}
                        >
                          <span style={{
                            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                            background: a.isActive ? 'var(--ok)' : 'var(--ink-3)',
                            flexShrink: 0,
                          }}/>
                          {a.isActive
                            ? <><IconZap size={11}/> Armed</>
                            : <><IconPause size={11}/> Paused</>}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {a.tokenSymbol?.includes('/') ? (
                            <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                              <TokenMark symbol={a.tokenSymbol.split('/')[0]} size={18}/>
                              <span style={{ marginLeft: -6, display: 'inline-flex' }}>
                                <TokenMark symbol={a.tokenSymbol.split('/')[1]} size={18}/>
                              </span>
                            </div>
                          ) : (
                            <TokenMark symbol={a.tokenSymbol ?? ''} size={18}/>
                          )}
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{a.tokenSymbol}</span>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                          {expr.lead} <span style={{ color: 'var(--amber-300)' }}>{expr.op}</span> <span style={{ color: 'var(--ink-1)' }}>{expr.val}</span>
                        </span>
                      </td>
                      <td>
                        <span className={`ga-pill ${actionInfo.tone === 'info' ? 'ga-pill-ok' : 'ga-pill-warn'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {a.action === 'BRIDGE' ? <IconFx size={10}/> : <IconBell size={10}/>}
                          {actionInfo.label}
                        </span>
                      </td>
                      <td style={{ color: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                        {new Date(a.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        <button
                          className="arc-link-btn"
                          style={{ color: 'var(--err)' }}
                          onClick={() => handleDelete(a.id)}
                          title="Delete watcher"
                        >
                          <IconClose size={12}/>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick templates */}
      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconSparkle size={13}/> Quick templates</span>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>one click pre-fills a working watcher</span>
        </div>
        <div style={{ padding: '14px 18px' }}>
          <div className="ga-template-grid">
            <TemplateChip
              title="USDC depeg watch"
              desc="Telegram alert when USDC slips off peg."
              example="USDC price < $0.99 -> Notify me"
              Icon={IconShield}
              onClick={() => openWithPrefill({
                symbol: 'USDC',
                condition: 'price below',
                value: '0.99',
                action: 'notify',
              })}
            />
            <TemplateChip
              title="Auto-bridge to Base"
              desc="When the agent has >= $50 USDC on Arc, ship $50 to Base via CCTP. Hands-free."
              example="USDC balance >= $50 -> Bridge $50 -> Base"
              Icon={IconFx}
              onClick={() => openWithPrefill({
                symbol: 'USDC',
                condition: 'balance reaches',
                value: '50',
                action: 'bridge',
                toChain: 'base-sepolia',
                bridgeAmount: '50',
              })}
            />
            <TemplateChip
              title="EURC rate watch"
              desc="Get pinged when EURC trades above $1.10. Useful for FX rotation."
              example="EURC price > $1.10 -> Notify me"
              Icon={IconBell}
              onClick={() => openWithPrefill({
                symbol: 'EURC',
                condition: 'price above',
                value: '1.10',
                action: 'notify',
              })}
            />
          </div>
        </div>
      </div>

    </div>
  );
}
