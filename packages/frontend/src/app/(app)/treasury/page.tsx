'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { formatUsd, formatNum } from '@/components/Atoms';
import { useBackendAuth } from '@/hooks/useBackendAuth';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import {
  IconTreasury, IconOrders, IconZap, IconSparkle, IconShield,
  IconCheck, IconCopy, IconExternal, IconPause, IconClose, IconSwap,
} from '@/components/Icons';
import { CardShell, GuardianVerdict, Row, ExplorerLink, sectionData, sectionError, Decision, Section } from './components';

const ARC_EXPLORER = 'https://testnet.arcscan.app';
const POLL_MS = 12_000;

type ArcBalance = { usdc?: string; eurc?: string; usyc?: string; native?: string };
type GatewayBalance = { total?: string; totalPending?: string; breakdown?: Array<{ chain: string; balance: string; pending?: string }> };
type EarnVault = { name?: string; protocol?: string; apy?: number; tvl?: string; token?: string } | null;
type EarnPosition = { currentBalance?: string; shares?: string; pnl?: { totalYieldEarned?: string }; rewards?: string } | null;
type UsycInfo = { price?: number; apy?: number; compliance?: string[] } | null;
type LimitOrder = { id: string; fromToken: string; toToken: string; amount: string; triggerPrice: string; direction: string; status: string };
type DcaOrder = { id: string; fromToken: string; toToken: string; amountPerCycle: string; frequency: string; status: string; nextRunAt: string | null; runCount?: number };
type BridgeRow = { id: string; fromChain: string; toChain: string; amount: string; status: string; txHash: string | null; createdAt: string };
type Policy = { perTxUsd?: number; dailyUsd?: number; approvalThresholdUsd?: number };

type Overview = {
  wallet: { address: string | null; isActive: boolean } | null;
  sections: {
    arcBalance?: Section<ArcBalance>;
    gateway?: Section<GatewayBalance>;
    earnVault?: Section<EarnVault>;
    earnPosition?: Section<EarnPosition>;
    usyc?: Section<UsycInfo>;
    limitOrders?: Section<LimitOrder[]>;
    dcaOrders?: Section<DcaOrder[]>;
    bridges?: Section<BridgeRow[]>;
    policy?: Section<Policy>;
    spentToday?: Section<number>;
  };
  updatedAt?: string;
};

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
};

export default function TreasuryPage() {
  const { ready } = useBackendAuth();
  const toast = useToast();
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ where: string; decision: Decision; reasons?: string[] } | null>(null);
  const [copied, setCopied] = useState(false);

  const [earnAmt, setEarnAmt] = useState('');
  const [gwAmt, setGwAmt] = useState('');
  const [tab, setTab] = useState<'limit' | 'dca'>('limit');

  const [loFrom, setLoFrom] = useState('USDC');
  const [loTo, setLoTo] = useState('EURC');
  const [loAmt, setLoAmt] = useState('');
  const [loPrice, setLoPrice] = useState('');
  const [loDir, setLoDir] = useState<'ABOVE' | 'BELOW'>('BELOW');

  const [dcFrom, setDcFrom] = useState('USDC');
  const [dcTo, setDcTo] = useState('EURC');
  const [dcAmt, setDcAmt] = useState('');
  const [dcFreq, setDcFreq] = useState<'HOURLY' | 'DAILY' | 'WEEKLY'>('DAILY');

  const load = useCallback(async (fresh = false) => {
    try {
      const d = await api.get<Overview>(`/treasury/overview${fresh ? '?fresh=1' : ''}`);
      setOv(d);
      setFailed(null);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Could not load treasury');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
    const t = setInterval(() => load(), POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [ready, load]);

  // Guardian answers on three different HTTP shapes: 403 throws with the reason,
  // 202 resolves with REQUIRE_APPROVAL, 200 resolves with ALLOW. Funnel all three
  // into the same verdict chip.
  const runAction = useCallback(async (
    where: string,
    label: string,
    fn: () => Promise<{ ok?: boolean; decision?: Decision; reasons?: string[]; txHash?: string | null }>,
  ) => {
    setBusy(where);
    setVerdict(null);
    const t = toast.pending(label, 'Guardian is checking this action');
    try {
      const r = await fn();
      if (r.decision === 'REQUIRE_APPROVAL') {
        setVerdict({ where, decision: 'REQUIRE_APPROVAL', reasons: r.reasons });
        t.error('Approval required', 'Approve this in Telegram to execute.');
      } else {
        setVerdict({ where, decision: 'ALLOW' });
        t.success(label, r.txHash ? 'Settled on Arc' : 'Done', r.txHash ?? null);
      }
      await load(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      const blocked = /guardian|blocked|denied|exceed/i.test(msg);
      setVerdict({ where, decision: blocked ? 'DENY' : 'ALLOW', reasons: blocked ? [msg] : undefined });
      t.error(blocked ? 'Guardian blocked this' : label, msg);
    } finally {
      setBusy(null);
    }
  }, [toast, load]);

  if (loading) {
    return (
      <div className="arc-page" style={{ alignItems: 'center', justifyContent: 'center', minHeight: 240 }}>
        <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading treasury…</span>
      </div>
    );
  }

  if (failed || !ov) {
    return (
      <div className="arc-page">
        <div className="arc-card" style={{ maxWidth: 520 }}>
          <div className="arc-card-head"><span className="arc-card-title"><IconTreasury size={13}/> Treasury</span></div>
          <div style={{ padding: '26px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 8 }}>Could not load the treasury</div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 18 }}>{failed}</p>
            <button className="arc-btn arc-btn-primary" onClick={() => { setLoading(true); load(true); }}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  if (!ov.wallet?.address) {
    return (
      <div className="arc-page">
        <div className="arc-card" style={{ maxWidth: 520 }}>
          <div className="arc-card-head"><span className="arc-card-title"><IconTreasury size={13}/> Treasury</span></div>
          <div style={{ padding: '28px 18px', textAlign: 'center' }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,150,72,0.10)', color: 'var(--amber-300)', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>
              <IconTreasury size={20}/>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 8 }}>No agent wallet yet</div>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 20 }}>
              The treasury runs on the agent&apos;s Circle wallet. Create one on the Wallet page first.
            </p>
            <a className="arc-btn arc-btn-primary" href="/wallet">Go to Wallet</a>
          </div>
        </div>
      </div>
    );
  }

  const S = ov.sections;
  const arc = sectionData<ArcBalance>(S.arcBalance, {});
  const gw = sectionData<GatewayBalance>(S.gateway, {});
  const vault = sectionData<EarnVault>(S.earnVault, null);
  const pos = sectionData<EarnPosition>(S.earnPosition, null);
  const usyc = sectionData<UsycInfo>(S.usyc, null);
  const limitOrders = sectionData<LimitOrder[]>(S.limitOrders, []);
  const dcaOrders = sectionData<DcaOrder[]>(S.dcaOrders, []);
  const bridges = sectionData<BridgeRow[]>(S.bridges, []);
  const policy = sectionData<Policy>(S.policy, {});
  const spentToday = sectionData<number>(S.spentToday, 0);

  const arcUsdc = num(arc.usdc);
  const unified = num(gw.total);
  const inYield = num(pos?.currentBalance);
  const idle = Math.max(arcUsdc - 5, 0);
  const address = ov.wallet.address as string;

  const activeLimit = limitOrders.filter(o => o.status === 'ACTIVE');
  const activeDca = dcaOrders.filter(o => o.status === 'ACTIVE' || o.status === 'PAUSED');

  const copy = () => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  };

  return (
    <div className="arc-page">

      <div className="arc-action-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', background: 'var(--bg-3)', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line-1)' }}>
            {address.slice(0, 10)}…{address.slice(-6)}
          </span>
          <button className="arc-link-btn" onClick={copy} style={copied ? { color: 'var(--ok)' } : undefined}>
            {copied ? <IconCheck size={11}/> : <IconCopy size={11}/>}
          </button>
          <a className="arc-link-btn" href={`${ARC_EXPLORER}/address/${address}`} target="_blank" rel="noopener noreferrer">
            <IconExternal size={11}/>
          </a>
          <span className="ga-pill ga-pill-ok" style={{ fontSize: 10 }}>
            <span className="ga-status-orb" style={{ width: 5, height: 5 }}/> Arc Testnet
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            spent today {formatUsd(spentToday)} of {formatUsd(policy.dailyUsd ?? 0)}
          </span>
          <button
            className="arc-btn arc-btn-primary"
            disabled={busy === 'autopilot'}
            onClick={() => runAction('autopilot', 'Treasury autopilot', () =>
              api.post<{ action?: string; detail?: string; txHash?: string | null; approvalId?: string }>('/agent/autopilot', {})
                .then(r => ({
                  ok: true,
                  decision: (r.approvalId ? 'REQUIRE_APPROVAL' : 'ALLOW') as Decision,
                  reasons: r.detail ? [r.detail] : undefined,
                  txHash: r.txHash ?? null,
                })))}
          >
            <IconZap size={12}/> {busy === 'autopilot' ? 'Running…' : 'Run autopilot'}
          </button>
        </div>
      </div>

      {verdict?.where === 'autopilot' && (
        <div style={{ marginTop: -4 }}><GuardianVerdict decision={verdict.decision} reasons={verdict.reasons}/></div>
      )}

      <div className="arc-kpi-row">
        <div className="arc-kpi">
          <div className="arc-kpi-label">Unified USDC</div>
          <div className="arc-kpi-value">{formatNum(unified)}</div>
          <div className="arc-kpi-sub">across {(gw.breakdown?.length ?? 0) || '-'} chains via Gateway</div>
        </div>
        <div className="arc-kpi">
          <div className="arc-kpi-label">On Arc</div>
          <div className="arc-kpi-value">{formatNum(arcUsdc)}</div>
          <div className="arc-kpi-sub">{formatNum(num(arc.eurc))} EURC alongside</div>
        </div>
        <div className="arc-kpi">
          <div className="arc-kpi-label">In yield</div>
          <div className="arc-kpi-value">{formatNum(inYield)}</div>
          <div className="arc-kpi-sub">{vault?.apy != null ? `${vault.apy}% APY` : 'Earn Kit vault'}</div>
        </div>
        <div className="arc-kpi">
          <div className="arc-kpi-label">Idle</div>
          <div className="arc-kpi-value">{formatNum(idle)}</div>
          <div className="arc-kpi-sub">max {formatUsd(policy.perTxUsd ?? 0)} per transaction</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>

        <CardShell title="Unified balance (Gateway)" icon={<IconSparkle size={13}/>} error={sectionError(S.gateway)}>
          <div className="arc-card-body">
            {(gw.breakdown ?? []).length === 0 ? (
              <div className="arc-empty" style={{ padding: '18px 0', fontSize: 12.5, color: 'var(--ink-3)' }}>
                No Gateway balance yet. Deposit USDC to spend it from any supported chain.
              </div>
            ) : (
              <div className="arc-table-wrap">
                <table className="arc-table">
                  <thead><tr><th>Chain</th><th>Confirmed</th><th>Pending</th></tr></thead>
                  <tbody>
                    {(gw.breakdown ?? []).map(b => (
                      <tr key={b.chain}>
                        <td>{b.chain}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNum(num(b.balance))}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink-3)' }}>{formatNum(num(b.pending))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input className="ga-input ga-input-mono" placeholder="0.00" value={gwAmt}
                onChange={e => setGwAmt(e.target.value.replace(/[^\d.]/g, ''))} style={{ flex: 1 }}/>
              <button className="arc-btn arc-btn-primary" disabled={!gwAmt || busy === 'gwdep'}
                onClick={() => runAction('gwdep', 'Deposit to Gateway', () =>
                  api.post('/treasury/gateway/deposit', { amount: gwAmt }))}>
                {busy === 'gwdep' ? 'Depositing…' : 'Deposit'}
              </button>
            </div>
            {verdict?.where === 'gwdep' && <GuardianVerdict decision={verdict.decision} reasons={verdict.reasons}/>}
          </div>
        </CardShell>

        <CardShell
          title="Yield"
          icon={<IconTreasury size={13}/>}
          error={sectionError(S.earnVault)}
          right={vault?.apy != null ? <span className="ga-pill ga-pill-ok" style={{ fontSize: 10 }}>{vault.apy}% APY</span> : undefined}
        >
          <div className="arc-card-body">
            <Row label="Vault" value={vault?.name ?? 'Earn Kit vault'}/>
            <Row label="Your balance" value={`${formatNum(inYield)} ${vault?.token ?? 'USDC'}`} mono/>
            <Row label="Yield earned" value={formatNum(num(pos?.pnl?.totalYieldEarned))} mono/>
            {usyc?.price != null && <Row label="USYC price" value={`$${usyc.price}`} mono/>}
            {usyc?.compliance && usyc.compliance.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.55 }}>
                {usyc.compliance.map((c, i) => <div key={i}>· {c}</div>)}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input className="ga-input ga-input-mono" placeholder="0.00" value={earnAmt}
                onChange={e => setEarnAmt(e.target.value.replace(/[^\d.]/g, ''))} style={{ flex: 1 }}/>
              <button className="arc-btn arc-btn-primary" disabled={!earnAmt || busy === 'earndep'}
                onClick={() => runAction('earndep', 'Allocate to yield', () =>
                  api.post('/treasury/earn/deposit', { amount: earnAmt }))}>
                {busy === 'earndep' ? 'Allocating…' : 'Allocate'}
              </button>
              <button className="arc-btn arc-btn-secondary" disabled={!earnAmt || busy === 'earnwd'}
                onClick={() => runAction('earnwd', 'Withdraw from yield', () =>
                  api.post('/treasury/earn/withdraw', { amount: earnAmt }))}>
                Withdraw
              </button>
            </div>
            {(verdict?.where === 'earndep' || verdict?.where === 'earnwd') && <GuardianVerdict decision={verdict.decision} reasons={verdict.reasons}/>}
          </div>
        </CardShell>
      </div>

      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconOrders size={13}/> Conditional automation</span>
          <div className="arc-card-head-right">
            <div className="arc-tab-bar">
              <button className={`arc-tab${tab === 'limit' ? ' arc-tab-active' : ''}`} onClick={() => setTab('limit')}>Limit orders</button>
              <button className={`arc-tab${tab === 'dca' ? ' arc-tab-active' : ''}`} onClick={() => setTab('dca')}>DCA</button>
            </div>
          </div>
        </div>
        <div className="arc-card-body">
          {tab === 'limit' ? (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <select className="ga-select" value={loFrom} onChange={e => setLoFrom(e.target.value)}>
                  {['USDC', 'EURC', 'USYC'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <span style={{ alignSelf: 'center', color: 'var(--ink-3)' }}><IconSwap size={12}/></span>
                <select className="ga-select" value={loTo} onChange={e => setLoTo(e.target.value)}>
                  {['EURC', 'USDC', 'USYC'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input className="ga-input ga-input-mono" placeholder="amount" value={loAmt}
                  onChange={e => setLoAmt(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: 110 }}/>
                <select className="ga-select" value={loDir} onChange={e => setLoDir(e.target.value as 'ABOVE' | 'BELOW')}>
                  <option value="BELOW">when price below</option>
                  <option value="ABOVE">when price above</option>
                </select>
                <input className="ga-input ga-input-mono" placeholder="trigger $" value={loPrice}
                  onChange={e => setLoPrice(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: 110 }}/>
                <button className="arc-btn arc-btn-primary" disabled={!loAmt || !loPrice || busy === 'limit'}
                  onClick={() => runAction('limit', 'Arm limit order', () =>
                    api.post('/treasury/orders/limit', {
                      fromToken: loFrom, toToken: loTo, amount: loAmt,
                      triggerPrice: parseFloat(loPrice), direction: loDir,
                    }).then(() => ({ ok: true, decision: 'ALLOW' as Decision })))}>
                  Arm
                </button>
              </div>
              {activeLimit.length === 0 ? (
                <div className="arc-empty" style={{ padding: '18px 0', fontSize: 12.5, color: 'var(--ink-3)' }}>
                  No armed limit orders. The scheduler checks every 30 seconds.
                </div>
              ) : (
                <div className="arc-table-wrap">
                  <table className="arc-table">
                    <thead><tr><th>Pair</th><th>Amount</th><th>Trigger</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                      {activeLimit.map(o => (
                        <tr key={o.id}>
                          <td>{o.fromToken} to {o.toToken}</td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>{o.amount}</td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>{o.direction === 'BELOW' ? 'below' : 'above'} ${o.triggerPrice}</td>
                          <td><span className="ga-pill ga-pill-ok" style={{ fontSize: 10 }}>{o.status}</span></td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="arc-link-btn" title="Cancel"
                              onClick={() => runAction('limit', 'Cancel limit order', () =>
                                api.delete(`/treasury/orders/limit/${o.id}`).then(() => ({ ok: true, decision: 'ALLOW' as Decision })))}>
                              <IconClose size={11}/>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <select className="ga-select" value={dcFrom} onChange={e => setDcFrom(e.target.value)}>
                  {['USDC', 'EURC'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <span style={{ alignSelf: 'center', color: 'var(--ink-3)' }}><IconSwap size={12}/></span>
                <select className="ga-select" value={dcTo} onChange={e => setDcTo(e.target.value)}>
                  {['EURC', 'USDC', 'USYC'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input className="ga-input ga-input-mono" placeholder="per cycle" value={dcAmt}
                  onChange={e => setDcAmt(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: 120 }}/>
                <select className="ga-select" value={dcFreq} onChange={e => setDcFreq(e.target.value as 'HOURLY' | 'DAILY' | 'WEEKLY')}>
                  <option value="HOURLY">hourly</option>
                  <option value="DAILY">daily</option>
                  <option value="WEEKLY">weekly</option>
                </select>
                <button className="arc-btn arc-btn-primary" disabled={!dcAmt || busy === 'dca'}
                  onClick={() => runAction('dca', 'Schedule DCA', () =>
                    api.post('/treasury/orders/dca', {
                      fromToken: dcFrom, toToken: dcTo, amountPerCycle: dcAmt, frequency: dcFreq,
                    }).then(() => ({ ok: true, decision: 'ALLOW' as Decision })))}>
                  Schedule
                </button>
              </div>
              {activeDca.length === 0 ? (
                <div className="arc-empty" style={{ padding: '18px 0', fontSize: 12.5, color: 'var(--ink-3)' }}>
                  No DCA schedules. The processor runs every 60 seconds.
                </div>
              ) : (
                <div className="arc-table-wrap">
                  <table className="arc-table">
                    <thead><tr><th>Pair</th><th>Per cycle</th><th>Frequency</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                      {activeDca.map(o => (
                        <tr key={o.id}>
                          <td>{o.fromToken} to {o.toToken}</td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>{o.amountPerCycle}</td>
                          <td>{o.frequency.toLowerCase()}</td>
                          <td><span className={`ga-pill ${o.status === 'ACTIVE' ? 'ga-pill-ok' : 'ga-pill-warn'}`} style={{ fontSize: 10 }}>{o.status}</span></td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button className="arc-link-btn" title={o.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                              onClick={() => runAction('dca', o.status === 'ACTIVE' ? 'Pause schedule' : 'Resume schedule', () =>
                                api.post(`/treasury/orders/dca/${o.id}/${o.status === 'ACTIVE' ? 'pause' : 'resume'}`, {})
                                  .then(() => ({ ok: true, decision: 'ALLOW' as Decision })))}>
                              <IconPause size={11}/>
                            </button>
                            <button className="arc-link-btn" title="Cancel"
                              onClick={() => runAction('dca', 'Cancel schedule', () =>
                                api.delete(`/treasury/orders/dca/${o.id}`).then(() => ({ ok: true, decision: 'ALLOW' as Decision })))}>
                              <IconClose size={11}/>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {(verdict?.where === 'limit' || verdict?.where === 'dca') && <GuardianVerdict decision={verdict.decision} reasons={verdict.reasons}/>}
        </div>
      </div>

      <CardShell title="Recent CCTP settlement" icon={<IconShield size={13}/>} error={sectionError(S.bridges)}>
        <div className="arc-card-body">
          {bridges.length === 0 ? (
            <div className="arc-empty" style={{ padding: '18px 0', fontSize: 12.5, color: 'var(--ink-3)' }}>
              No bridges yet. Ask Aegis in chat to bridge USDC to Base.
            </div>
          ) : (
            <div className="arc-table-wrap">
              <table className="arc-table">
                <thead><tr><th>Route</th><th>Amount</th><th>Status</th><th>Tx</th></tr></thead>
                <tbody>
                  {bridges.map(b => (
                    <tr key={b.id}>
                      <td>{b.fromChain} to {b.toChain}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{b.amount}</td>
                      <td>
                        <span className={`ga-pill ${b.status === 'SUCCESS' ? 'ga-pill-ok' : b.status === 'FAILED' ? 'ga-pill-err' : 'ga-pill-warn'}`} style={{ fontSize: 10 }}>
                          {b.status}
                        </span>
                      </td>
                      <td>{b.txHash ? <ExplorerLink hash={b.txHash} base={ARC_EXPLORER}/> : <span style={{ color: 'var(--ink-3)' }}>-</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardShell>

    </div>
  );
}
