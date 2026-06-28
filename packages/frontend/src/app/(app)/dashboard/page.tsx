'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TokenMark, formatUsd } from '@/components/Atoms';
import { IconSparkle, IconShield, IconAlert, IconArrowRight, IconArrowUp, IconWallet, IconCopy, IconCheck, IconExternal, IconSwap, IconUpload, IconArrowDown, IconBridge, IconOrders, IconChat, IconFaucet, IconClose } from '@/components/Icons';
import { useToast } from '@/components/ui/toast';
import { useBackendAuth } from '@/hooks/useBackendAuth';
import { api } from '@/lib/api';

interface WalletData {
  agentAddress: string;
  balance: { usdc: string | number; eurc: string | number };
}
interface ChainBalance {
  chain: string;
  label: string;
  usdc: number;
  addressExplorerUrl?: string;
  txExplorerBase?: string;
  native?: boolean;
}
interface PendingBridge {
  id: string;
  fromChain: string;
  toChain: string;
  amount: string;
  status: string;
  error?: string | null;
  createdAt: string;
}
interface PolicyData {
  perTxUsd: number | null;
  dailyUsd: number | null;
  allowTokens: string[] | null;
}
interface AlertRule {
  id: string;
  name?: string;
  tokenSymbol: string;
  condition: string;
  threshold: number;
  isActive: boolean;
}
interface TxEntry {
  id: string;
  type: string;
  tokenIn: string;
  tokenOut: string | null;
  amount: string;
  amountUsd: number | null;
  txHash: string | null;
  toAddress: string | null;
  status: string;
  network: string;
  createdAt: string;
}

const ARC_EXPLORER = 'https://testnet.arcscan.app';

interface ChainDef { id: string; name: string; tag: string; color: string; }
// Only chains actually supported by the backend CHAIN_MAP / arcBridge service.
// Polygon is NOT wired - remove it to avoid misleading users.
const CHAINS: ChainDef[] = [
  { id: 'arc',      name: 'Arc Testnet',      tag: 'ARC',  color: '#C4622A' },
  { id: 'base',     name: 'Base Sepolia',     tag: 'BASE', color: '#0052FF' },
  { id: 'ethereum', name: 'Eth Sepolia',      tag: 'ETH',  color: '#627EEA' },
];

const ACTIVITY_FILTERS: Array<{ id: string; label: string; match: (t: TxEntry) => boolean }> = [
  { id: 'all',    label: 'All',        match: () => true },
  { id: 'bridge', label: 'Bridge',     match: (t) => /bridge/i.test(t.type) },
  { id: 'swap',   label: 'Swap',       match: (t) => /swap/i.test(t.type) },
  { id: 'send',   label: 'Send',       match: (t) => /withdraw|transfer|send/i.test(t.type) },
  { id: 'job',    label: 'Jobs',       match: (t) => /job/i.test(t.type) },
  { id: 'failed', label: 'Failed only', match: (t) => /FAILED|REJECTED/i.test(t.status) },
];

const TX_LABELS: Record<string, string> = {
  // Money movement
  WITHDRAW:          'Send',
  TRANSFER:          'Send',
  SEND:              'Send',
  SEND_USDC:         'Send',
  RECEIVE:           'Receive',
  DEPOSIT:           'Deposit',
  FAUCET:            'Faucet',
  // Swap
  SWAP:              'Swap',
  SWAP_EXECUTED:     'Swap',
  // Bridge
  BRIDGE:            'Bridge',
  BRIDGE_SUBMITTED:  'Bridge',
  CCTP_BRIDGE:       'Bridge',
  // Gateway
  GATEWAY_DEPOSIT:   'Gateway in',
  GATEWAY_SPEND:     'Gateway out',
  GATEWAY_BALANCE:   'Gateway',
  // Earn (Hashnote USYC)
  EARN_DEPOSIT:      'Earn in',
  EARN_WITHDRAW:     'Earn out',
  // Jobs (ERC-8183)
  JOB_CREATE:        'Job create',
  JOB_CREATED:       'Job create',
  JOB_BUDGET:        'Job budget',
  JOB_BUDGET_SET:    'Job budget',
  JOB_FUND:          'Job fund',
  JOB_FUNDED:        'Job fund',
  JOB_SUBMIT:        'Job submit',
  JOB_SUBMITTED:     'Job submit',
  JOB_COMPLETE:      'Job complete',
  JOB_COMPLETED:     'Job complete',
  // Aegis x402
  AEGIS_PAY:         'Pay x402',
  AEGIS_PAY_OK:      'Pay x402',
  AEGIS_PAY_FAIL:    'Pay x402',
  // Approvals
  APPROVE:           'Approve',
  APPROVAL:          'Approve',
  USDC_APPROVE:      'Approve',
  // Rules
  RULE_BRIDGE_EXECUTED: 'Auto bridge',
  RULE_BRIDGE_GATED:    'Auto bridge',
  RULE_BRIDGE_FAILED:   'Auto bridge',
  AUTONOMOUS_RULE_CREATED: 'Rule create',
  // ERC-8004
  ERC8004_REGISTERED: 'Register',
  REPUTATION:         'Feedback',
  VALIDATION:         'Validate',
};

function formatTxType(type: string): string {
  if (!type) return '-';
  if (TX_LABELS[type]) return TX_LABELS[type];
  // Fallback: split underscore-separated, title-case each word, max 2 words.
  const parts = type.replace(/[_-]+/g, ' ').toLowerCase().trim().split(/\s+/);
  const words = parts.slice(0, 2).map(w => w ? w[0].toUpperCase() + w.slice(1) : '');
  return words.join(' ');
}

// Maps a raw tx.type to (a) its color category for .ga-tx-icon[data-type=X]
// and (b) the React icon component to render inside. Stays in sync with the
// CSS swatches in globals.css (.ga-tx-icon[data-type="bridge"|"deposit"|…]).
function txIconMeta(type: string): { dataType: string; Icon: React.ComponentType<{ size?: number }> } {
  const t = (type || '').toUpperCase();
  if (/BRIDGE|CCTP/.test(t))                          return { dataType: 'bridge',   Icon: IconBridge };
  if (/RULE_BRIDGE|AUTONOMOUS_RULE/.test(t))          return { dataType: 'bridge',   Icon: IconBridge };
  if (/SWAP/.test(t))                                 return { dataType: 'swap',     Icon: IconSwap };
  if (/DEPOSIT|RECEIVE|FAUCET/.test(t))               return { dataType: 'deposit',  Icon: IconArrowDown };
  if (/EARN_IN|EARN_DEPOSIT/.test(t))                 return { dataType: 'deposit',  Icon: IconArrowDown };
  if (/GATEWAY_DEPOSIT|GATEWAY_IN/.test(t))           return { dataType: 'deposit',  Icon: IconArrowDown };
  if (/WITHDRAW|TRANSFER|SEND|GATEWAY_SPEND|EARN_OUT|EARN_WITHDRAW/.test(t))
                                                       return { dataType: 'withdraw', Icon: IconUpload };
  if (/JOB/.test(t))                                  return { dataType: 'job',      Icon: IconOrders };
  if (/AEGIS|PAY|REPUTATION|VALIDATION|REGISTER|ERC8004/.test(t))
                                                       return { dataType: 'agent',    Icon: IconSparkle };
  if (/APPROVE|APPROVAL/.test(t))                     return { dataType: '',         Icon: IconShield };
  return { dataType: '', Icon: IconSparkle };
}
function statusPillClass(status: string): string {
  if (status === 'SUCCESS') return 'ga-pill ga-pill-ok';
  if (status === 'FAILED' || status === 'REJECTED') return 'ga-pill ga-pill-err';
  if (status === 'PENDING_APPROVAL') return 'ga-pill ga-pill-warn';
  return 'ga-pill';
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function truncateAddr(a: string, head = 6, tail = 4) {
  if (!a) return '-';
  if (a.length <= head + tail + 2) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

function hoursUntilUtcMidnight(): number {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return Math.max(0, Math.round((midnight.getTime() - now.getTime()) / 3_600_000));
}

function Sparkline({ values, accent }: { values: number[]; accent?: boolean }) {
  const max = Math.max(...values, 1);
  const w = 100; const h = 28; const gap = 3;
  const barW = (w - gap * (values.length - 1)) / values.length;
  return (
    <svg className="ga-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      {values.map((v, i) => {
        const bh = Math.max(2, (v / max) * h);
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={h - bh}
            width={barW}
            height={bh}
            rx={1}
            fill={accent ? 'var(--amber-400)' : 'var(--ok)'}
            opacity={0.55 + (i / values.length) * 0.45}
          />
        );
      })}
    </svg>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { ready } = useBackendAuth();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [copied, setCopied] = useState(false);
  const [policy, setPolicy] = useState<PolicyData | null>(null);
  const [spentToday, setSpentToday] = useState<number>(0);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [txs, setTxs] = useState<TxEntry[]>([]);
  const [activityFilter, setActivityFilter] = useState<string>('all');
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [triedAegis, setTriedAegis] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [chainBalances, setChainBalances] = useState<ChainBalance[]>([]);
  const [pendingBridges, setPendingBridges] = useState<PendingBridge[]>([]);

  // Restore onboarding-related flags from localStorage on mount.
  // Wrapped because localStorage throws in private-mode / storage-blocked contexts.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setTriedAegis(localStorage.getItem('ga-tried-aegis') === '1');
      setOnboardingDismissed(localStorage.getItem('ga-onboarding-dismissed') === '1');
    } catch { /* storage blocked - keep defaults */ }
  }, []);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        const [walletRes, policyRes, alertsRes, auditRes, crossChainRes, bridgesRes] = await Promise.all([
          api.get<{ wallet: WalletData | null }>('/agent-wallet'),
          api.get<{ policy: PolicyData; spentToday: number }>('/guardian/policy').catch(() => ({ policy: null, spentToday: 0 })),
          api.get<{ rules: AlertRule[] }>('/rules').catch(() => ({ rules: [] })),
          api.get<{ transactions: TxEntry[] }>('/agent-wallet/transactions').catch(() => ({ transactions: [] })),
          api.get<{ chains: ChainBalance[]; totalUsdc: number }>('/agent-wallet/cross-chain').catch(() => ({ chains: [], totalUsdc: 0 })),
          api.get<{ bridges: PendingBridge[] }>('/bridge').catch(() => ({ bridges: [] })),
        ]);
        setWallet(walletRes.wallet);
        if (policyRes.policy) setPolicy(policyRes.policy);
        setSpentToday(policyRes.spentToday ?? 0);
        setAlerts(alertsRes.rules ?? []);
        setTxs((auditRes.transactions ?? []).slice(0, 12));
        setChainBalances((crossChainRes.chains ?? []).filter(c => c.usdc > 0 || c.native));
        const inFlight = (bridgesRes.bridges ?? []).filter(b =>
          ['PENDING', 'PROCESSING', 'SUBMITTED', 'ATTESTING', 'MINTING'].includes(b.status.toUpperCase())
        );
        setPendingBridges(inFlight);
      } finally {
        setLoading(false);
      }
    })();
  }, [ready]);

  // Poll bridge status every 15s while there are in-flight bridges
  useEffect(() => {
    if (!ready || pendingBridges.length === 0) return;
    const interval = setInterval(async () => {
      try {
        const [bridgesRes, crossChainRes] = await Promise.all([
          api.get<{ bridges: PendingBridge[] }>('/bridge'),
          api.get<{ chains: ChainBalance[] }>('/agent-wallet/cross-chain?fresh=1'),
        ]);
        const inFlight = (bridgesRes.bridges ?? []).filter(b =>
          ['PENDING', 'PROCESSING', 'SUBMITTED', 'ATTESTING', 'MINTING'].includes(b.status.toUpperCase())
        );
        setPendingBridges(inFlight);
        setChainBalances((crossChainRes.chains ?? []).filter(c => c.usdc > 0 || c.native));
      } catch { /* ignore */ }
    }, 15_000);
    return () => clearInterval(interval);
  }, [ready, pendingBridges.length]);

  if (loading) {
    return (
      <div className="ga-page" style={{ alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
        <span className="ga-meta">Loading…</span>
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="ga-page" style={{ alignItems: 'center' }}>
        <div className="ga-card ga-card-glow" style={{ maxWidth: 560, margin: '32px auto', padding: '36px 32px', textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(255,150,72,0.12)', color: 'var(--amber-300)', display: 'grid', placeItems: 'center', margin: '0 auto 20px' }}>
            <IconWallet size={24}/>
          </div>
          <div className="ga-eyebrow" style={{ marginBottom: 8 }}>Setup required</div>
          <h2 className="ga-h2" style={{ fontStyle: 'normal', fontSize: 26, marginBottom: 10 }}>Create your agent wallet</h2>
          <p style={{ fontSize: 13.5, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 26, maxWidth: 400, margin: '0 auto 26px' }}>
            A Circle Developer-Controlled Wallet on Arc Testnet. The agent uses it, bounded by your Guardian policy.
          </p>
          <button className="btn btn-agent" onClick={() => router.push('/wallet')}>
            Set up wallet <IconArrowRight size={13}/>
          </button>
        </div>
      </div>
    );
  }

  function copyAddress() {
    navigator.clipboard.writeText(wallet!.agentAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  const usdc = parseFloat(String(wallet.balance.usdc || 0));
  const eurc = parseFloat(String(wallet.balance.eurc || 0));
  const totalUsd = usdc + eurc;
  const dailyCap = policy?.dailyUsd ?? null;
  const dailyPct = dailyCap && dailyCap > 0 ? Math.min((spentToday / dailyCap) * 100, 100) : null;
  const activeAlerts = alerts.filter(a => a.isActive);

  // Onboarding state
  const hasFunds = usdc > 0 || eurc > 0;
  const hasRules = alerts.length > 0;
  const stepsDone = [hasFunds, hasRules, triedAegis].filter(Boolean).length;
  const allDone = stepsDone === 3;
  const showOnboarding = !allDone && !onboardingDismissed;

  function handleFaucetDrop() {
    if (faucetBusy) return;
    setFaucetBusy(true);
    if (wallet?.agentAddress) {
      navigator.clipboard.writeText(wallet.agentAddress).catch(() => {});
      toast.success('Address copied', 'Paste it in the Circle faucet and pick Arc Testnet');
    } else {
      toast.success('Opening Circle faucet', 'Select Arc Testnet and paste your agent wallet address');
    }
    window.open('https://faucet.circle.com', '_blank', 'noopener,noreferrer');

    // The Circle faucet is a manual external flow that lands in 10-60s, so poll
    // the wallet for a balance increase rather than checking once. Stop as soon
    // as USDC goes up (toast the user) or after ~90s.
    const before = parseFloat(String(wallet?.balance?.usdc ?? 0)) || 0;
    let attempts = 0;
    const iv = setInterval(async () => {
      attempts += 1;
      try {
        const d = await api.get<{ wallet: WalletData | null }>('/agent-wallet?fresh=1');
        if (d.wallet) {
          setWallet(d.wallet);
          const now = parseFloat(String(d.wallet.balance?.usdc ?? 0)) || 0;
          if (now > before) {
            toast.success('USDC arrived', `Agent wallet funded with ${(now - before).toFixed(2)} USDC on Arc`);
            clearInterval(iv);
            setFaucetBusy(false);
          }
        }
      } catch { /* keep polling */ }
      if (attempts >= 18) { clearInterval(iv); setFaucetBusy(false); }
    }, 5000);
  }

  function dismissOnboarding() {
    try { localStorage.setItem('ga-onboarding-dismissed', '1'); } catch { /* storage blocked */ }
    setOnboardingDismissed(true);
  }

  function goToAegis() {
    try { localStorage.setItem('ga-tried-aegis', '1'); } catch { /* storage blocked */ }
    setTriedAegis(true);
    router.push('/chat');
  }

  return (
    <div className="arc-page">

      {/* Arc action bar */}
      <div className="arc-action-bar">
        <div className="arc-action-bar-left">
          <span className="arc-addr-chip">
            <IconWallet size={12}/>
            <span className="arc-addr-mono" title={wallet.agentAddress}>
              {wallet.agentAddress.slice(0, 8)}…{wallet.agentAddress.slice(-6)}
            </span>
            <button className="arc-addr-copy" onClick={copyAddress} title="Copy address">
              {copied ? <IconCheck size={11}/> : <IconCopy size={11}/>}
            </button>
            <a className="arc-addr-copy" href={`${ARC_EXPLORER}/address/${wallet.agentAddress}`}
              target="_blank" rel="noopener noreferrer" title="View on Arcscan">
              <IconExternal size={11}/>
            </a>
          </span>
          <span className="arc-network-badge">
            <span className="arc-dot arc-dot-ok"/> Arc Testnet
          </span>
        </div>
        <div className="arc-action-bar-right">
          <button className="arc-btn arc-btn-primary" onClick={() => router.push('/chat')}>
            <IconChat size={13}/> Ask Aegis
          </button>
        </div>
      </div>

      {/* Balance hero */}
      <div className="arc-balance-hero">
        <div className="arc-balance-hero-left">
          <div className="arc-balance-hero-label">Total balance</div>
          <div className="arc-balance-hero-value">{formatUsd(totalUsd)}</div>
          <div className="arc-balance-hero-tokens">
            <span className="arc-balance-hero-token">
              <span className="arc-balance-hero-token-dot" style={{ background: '#2775ca' }}/>
              {usdc.toFixed(2)} USDC
            </span>
            <span className="arc-balance-hero-sep">·</span>
            <span className="arc-balance-hero-token">
              <span className="arc-balance-hero-token-dot" style={{ background: '#3a78ff' }}/>
              {eurc.toFixed(2)} EURC
            </span>
          </div>
        </div>
        <div className="arc-balance-hero-divider"/>
        <div className="arc-kpi-mini">
          <div className="arc-kpi-label">Daily spent</div>
          <div className={`arc-kpi-value-sm${(dailyPct ?? 0) > 80 ? ' arc-kpi-value-warn' : ''}`}>{formatUsd(spentToday)}</div>
          <div className="arc-kpi-sub">of {dailyCap !== null ? formatUsd(dailyCap) : 'no cap'} · {hoursUntilUtcMidnight()}h left</div>
          {dailyPct !== null && dailyPct > 0 && (
            <div className="arc-balance-hero-bar">
              <div className="arc-balance-hero-bar-fill" style={{ width: `${Math.min(100, dailyPct)}%`, background: (dailyPct ?? 0) > 80 ? 'var(--err)' : 'var(--ok)' }}/>
            </div>
          )}
        </div>
        <div className="arc-balance-hero-divider"/>
        <div className="arc-kpi-mini arc-kpi-clickable" onClick={() => router.push('/alerts')}>
          <div className="arc-kpi-label">Alert rules</div>
          <div className="arc-kpi-value-sm">
            {activeAlerts.length}<span style={{ fontSize: 14, color: 'var(--ink-3)' }}>/{alerts.length}</span>
          </div>
          <div className="arc-kpi-sub">{activeAlerts.length > 0 ? 'armed · 60s' : 'idle'}</div>
        </div>
      </div>

      {/* In-flight bridge status banner */}
      {pendingBridges.map(b => (
        <BridgeStatusBanner key={b.id} bridge={b} />
      ))}

      {/* Chain balance cards - live from /agent-wallet/cross-chain */}
      <div className="arc-chain-row">
        {CHAINS.map(chain => {
          const live = chainBalances.find(c =>
            c.chain === chain.id ||
            (chain.id === 'arc' && c.native) ||
            (chain.id === 'base' && (c.chain.includes('base') || c.label?.toLowerCase().includes('base'))) ||
            (chain.id === 'ethereum' && (c.chain.includes('eth') || c.label?.toLowerCase().includes('eth'))) ||
            (chain.id === 'polygon' && (c.chain.includes('polygon') || c.label?.toLowerCase().includes('polygon')))
          );
          const chainUsdc = live?.usdc ?? (chain.id === 'arc' ? usdc : 0);
          const chainEurc = chain.id === 'arc' ? eurc : 0;
          return (
            <ChainCard
              key={chain.id}
              chain={chain}
              usdc={chainUsdc}
              eurc={chainEurc}
              active={chain.id === 'arc' || chainUsdc > 0}
              explorerUrl={live?.addressExplorerUrl}
              onBridge={() => router.push('/chat')}
            />
          );
        })}
      </div>

      {/* Main 2-col */}
      <div className="arc-dashboard-grid">

        {/* Activity */}
        <div className="arc-card">
          <div className="arc-card-head">
            <span className="arc-card-title">Recent activity</span>
            <div className="arc-card-head-right">
              <div className="arc-tab-bar">
                {ACTIVITY_FILTERS.map(f => (
                  <button
                    key={f.id}
                    className={`arc-tab${activityFilter === f.id ? ' arc-tab-active' : ''}`}
                    onClick={() => setActivityFilter(f.id)}
                  >
                    {f.label}
                    <span className="arc-tab-count">{txs.filter(f.match).length}</span>
                  </button>
                ))}
              </div>
              <button className="arc-link-btn" onClick={() => router.push('/audit')}>
                Full log <IconArrowRight size={11}/>
              </button>
            </div>
          </div>
          {(() => {
            const filtered = txs.filter(ACTIVITY_FILTERS.find(f => f.id === activityFilter)?.match ?? (() => true));
            if (filtered.length === 0) {
              return <div className="arc-empty">No matching activity. Open the chat to give Aegis a task.</div>;
            }
            return (
              <div className="arc-table-wrap">
                <table className="arc-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Detail</th>
                      <th>Status</th>
                      <th className="arc-td-right">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => {
                      const meta = txIconMeta(t.type);
                      const Icon = meta.Icon;
                      const explorerUrl = t.txHash ? `${ARC_EXPLORER}/tx/${t.txHash}` : null;
                      return (
                        <tr key={t.id}
                          className={explorerUrl ? 'arc-tr-link' : ''}
                          onClick={explorerUrl ? () => window.open(explorerUrl!, '_blank', 'noopener,noreferrer') : undefined}
                        >
                          <td>
                            <div className="arc-tx-cell">
                              <span className="arc-tx-icon" data-type={meta.dataType}><Icon size={11}/></span>
                              <span className="arc-tx-label">{formatTxType(t.type)}</span>
                            </div>
                          </td>
                          <td className="arc-td-detail">
                            <span className="arc-mono">{t.amount}</span>{' '}
                            <span className="arc-mono arc-sm">{t.tokenIn}</span>
                            {t.tokenOut && t.tokenOut !== t.tokenIn && (
                              <span className="arc-mono arc-sm"> → {t.tokenOut}</span>
                            )}
                          </td>
                          <td>
                            <span className={`arc-status-pill ${statusPillClass(t.status)}`}>
                              {t.status === 'PENDING_APPROVAL' ? 'pending' : t.status.toLowerCase()}
                            </span>
                          </td>
                          <td className="arc-td-right arc-mono arc-sm">
                            {timeAgo(t.createdAt)}
                            {explorerUrl && <IconExternal size={10} style={{marginLeft: 4, opacity: 0.4}}/>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>

        {/* Right column */}
        <div className="arc-sidebar-stack">

          {/* Guardian */}
          <div className="arc-card">
            <div className="arc-card-head">
              <span className="arc-card-title"><IconShield size={13}/> Guardian policy</span>
              <button className="arc-link-btn" onClick={() => router.push('/guardian')}>
                Edit <IconArrowRight size={11}/>
              </button>
            </div>
            <div className="arc-policy-rows">
              <PolicyVisualRow
                label="Per-tx cap"
                value={policy?.perTxUsd ? formatUsd(policy.perTxUsd) : 'not set'}
                pct={policy?.perTxUsd && policy.dailyUsd ? Math.min(100, (policy.perTxUsd / policy.dailyUsd) * 100) : 0}
                tone="info"
                hint={policy?.perTxUsd && policy.dailyUsd ? `${Math.round((policy.perTxUsd / policy.dailyUsd) * 100)}% of daily` : 'set both caps'}
              />
              <PolicyVisualRow
                label="Daily usage"
                value={`${formatUsd(spentToday)} / ${policy?.dailyUsd ? formatUsd(policy.dailyUsd) : '-'}`}
                pct={dailyPct ?? 0}
                tone={(dailyPct ?? 0) > 80 ? 'err' : 'ok'}
                hint={dailyCap ? `${Math.round(dailyPct ?? 0)}% spent` : 'no cap'}
              />
              <div>
                <div className="arc-policy-label">Allowed tokens</div>
                <div className="arc-token-pills">
                  {(policy?.allowTokens?.length ? policy.allowTokens : ['USDC', 'EURC']).map(t => (
                    <span key={t} className="arc-token-pill">
                      <TokenMark symbol={t} size={10}/> {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Alerts */}
          <div className="arc-card">
            <div className="arc-card-head">
              <span className="arc-card-title"><IconAlert size={13}/> Watching rules</span>
              <button className="arc-link-btn" onClick={() => router.push('/alerts')}>
                Manage <IconArrowRight size={11}/>
              </button>
            </div>
            {activeAlerts.length === 0 ? (
              <div className="arc-empty">No rules armed yet.</div>
            ) : (
              <div className="arc-alert-list">
                {activeAlerts.slice(0, 6).map(a => (
                  <div key={a.id} className="arc-alert-row">
                    <span className="arc-dot arc-dot-ok"/>
                    <TokenMark symbol={a.tokenSymbol} size={12}/>
                    <span className="arc-alert-token">{a.tokenSymbol}</span>
                    <span className="arc-alert-cond">{a.condition === 'ABOVE' ? '↑' : '↓'} {a.threshold}</span>
                    <span className="arc-alert-freq">60s</span>
                  </div>
                ))}
                {activeAlerts.length > 6 && (
                  <div className="arc-meta">+{activeAlerts.length - 6} more</div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

function PolicyRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: muted ? 'var(--ink-4)' : 'var(--ink-1)' }}>{value}</span>
    </div>
  );
}

// Bigger sparkline used as the visual top of the wallet balance hero card.
// Smooth line + area fill in amber, normalised to fill the card width.
function SparklineHero({ values }: { values: number[] }) {
  const W = 320, H = 56;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = W / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = H - 4 - ((v - min) / range) * (H - 8);
    return [x, y];
  });
  const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const areaPath = `${linePath} L ${W} ${H} L 0 ${H} Z`;
  return (
    <svg className="ga-balance-hero-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="bal-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(255,150,72,0.32)"/>
          <stop offset="100%" stopColor="rgba(255,150,72,0)"/>
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#bal-spark)"/>
      <path d={linePath}  fill="none" stroke="rgb(255,150,72)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function OnboardStep({ n, done, title, desc, children }: {
  n: number;
  done: boolean;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ga-onboard-step" data-done={done}>
      <div className="ga-onboard-step-marker">
        {done ? <IconCheck size={13}/> : <span className="ga-onboard-step-n">{n}</span>}
      </div>
      <div className="ga-onboard-step-body">
        <div className="ga-onboard-step-title">{title}</div>
        <div className="ga-onboard-step-desc">{desc}</div>
      </div>
      <div className="ga-onboard-step-action">{children}</div>
    </div>
  );
}

function PolicyVisualRow({ label, value, pct, tone, hint }: { label: string; value: string; pct: number; tone: 'ok' | 'err' | 'info'; hint: string }) {
  const fillClass = tone === 'err' ? 'ga-progress-fill-err' : tone === 'info' ? '' : '';
  const barColor = tone === 'err' ? 'var(--err)' : tone === 'info' ? 'var(--info)' : 'var(--ok)';
  return (
    <div>
      <div className="ga-policy-row-head">
        <span className="ga-policy-row-label">{label}</span>
        <span className="ga-policy-row-value">{value}</span>
      </div>
      <div className="ga-progress" style={{ marginTop: 6 }}>
        <div className={`ga-progress-fill ${fillClass}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: barColor }}/>
      </div>
      <div className="ga-policy-row-hint">{hint}</div>
    </div>
  );
}

function PortfolioChart({ txs, currentBalance }: { txs: TxEntry[]; currentBalance: number }) {
  const W = 240, H = 60;
  const pts = React.useMemo(() => {
    const arr: number[] = [currentBalance];
    let running = currentBalance;
    for (const tx of txs.slice(0, 6)) {
      const amt = tx.amountUsd ?? 0;
      const t = (tx.type || '').toUpperCase();
      if (/WITHDRAW|TRANSFER|SEND|GATEWAY_SPEND|EARN_WITHDRAW/.test(t)) running += amt;
      else if (/DEPOSIT|RECEIVE|FAUCET|EARN_DEPOSIT|GATEWAY_DEPOSIT/.test(t)) running = Math.max(0, running - amt);
      arr.unshift(running);
    }
    while (arr.length < 7) arr.unshift(arr[0]);
    return arr.slice(-7);
  }, [txs, currentBalance]);

  const min = Math.min(...pts);
  const max = Math.max(...pts, min + 0.01);
  const range = max - min;
  const pad = 6;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;
  const stepX = innerW / (pts.length - 1);
  const points = pts.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return [x, y] as [number, number];
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${(pad + innerW).toFixed(1)},${(pad + innerH).toFixed(1)} L${pad},${(pad + innerH).toFixed(1)} Z`;
  const isUp = pts[pts.length - 1] >= pts[0];
  const stroke = isUp ? 'var(--ok)' : 'var(--err)';
  const fillId = `pf-${isUp ? 'up' : 'dn'}`;

  return (
    <svg className="arc-portfolio-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.18"/>
          <stop offset="100%" stopColor={stroke} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${fillId})`}/>
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      {points.map(([x, y], i) => i === points.length - 1 ? (
        <circle key={i} cx={x} cy={y} r="3" fill={stroke}/>
      ) : null)}
    </svg>
  );
}

function ChainCard({ chain, usdc, eurc, active, onBridge, explorerUrl }: {
  chain: ChainDef; usdc: number; eurc: number; active: boolean;
  onBridge: () => void; explorerUrl?: string;
}) {
  const total = usdc + eurc;
  const hasFunds = total > 0;
  return (
    <div className={`arc-chain-card${active ? ' arc-chain-card-active' : ''}${hasFunds && !chain.id.includes('arc') ? ' arc-chain-card-funded' : ''}`}>
      <div className="arc-chain-card-head">
        <span className="arc-chain-dot" style={{ background: chain.color }}/>
        <span className="arc-chain-name">{chain.name}</span>
        {explorerUrl && hasFunds && (
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="arc-chain-explorer" title="View on explorer">
            <IconExternal size={10}/>
          </a>
        )}
      </div>
      <div className="arc-chain-balance" style={{ color: hasFunds ? 'var(--ink-1)' : 'var(--ink-4)' }}>
        {hasFunds ? `$${total.toFixed(2)}` : '-'}
      </div>
      <div className="arc-chain-tokens">
        <span style={{ color: usdc > 0 ? 'var(--ink-2)' : 'var(--ink-4)' }}>
          {usdc > 0 ? `${usdc.toFixed(2)} USDC` : active ? '0 USDC' : '-'}
        </span>
        {eurc > 0 && <span>{eurc.toFixed(2)} EURC</span>}
      </div>
      {!hasFunds && chain.id !== 'arc' && (
        <button className="arc-chain-bridge-btn" onClick={onBridge}>Bridge in →</button>
      )}
    </div>
  );
}

const BRIDGE_STATUS_LABELS: Record<string, { label: string; pct: number }> = {
  PENDING:    { label: 'Submitting to Arc',         pct: 15 },
  SUBMITTED:  { label: 'Transaction confirmed',     pct: 35 },
  PROCESSING: { label: 'Awaiting CCTP attestation', pct: 55 },
  ATTESTING:  { label: 'Circle attesting',          pct: 72 },
  MINTING:    { label: 'Minting on destination',    pct: 88 },
  COMPLETE:   { label: 'Complete',                  pct: 100 },
  FAILED:     { label: 'Failed',                    pct: 0 },
};

function friendlyBridgeError(raw: string | null | undefined): string {
  if (!raw) return 'Bridge failed. Try again.';
  const r = raw.toLowerCase();
  if (r.includes('max fee must be less than amount') || (r.includes('fee') && r.includes('amount')))
    return 'Fee exceeded amount - try 5+ USDC';
  if (r.includes('simulation failed'))
    return 'Tx simulation failed on Arc Testnet';
  if (r.includes('insufficient') || r.includes('balance'))
    return 'Insufficient balance for amount + fees';
  if (r.includes('timeout') || r.includes('restarted') || r.includes('timed out'))
    return 'Interrupted - funds are safe, check balance';
  if (r.includes('unsupported') || r.includes('route'))
    return 'Route not supported';
  return raw.length < 80 ? raw : 'Unexpected error';
}

function BridgeStatusBanner({ bridge }: { bridge: PendingBridge }) {
  const s = bridge.status.toUpperCase();
  const isFailed = s === 'FAILED';
  const meta = BRIDGE_STATUS_LABELS[s] ?? { label: bridge.status, pct: 25 };
  const toLabel = bridge.toChain.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const elapsed = Math.round((Date.now() - new Date(bridge.createdAt).getTime()) / 60000);
  const errText = isFailed ? friendlyBridgeError(bridge.error) : null;

  return (
    <div className={`arc-bridge-banner${isFailed ? ' arc-bridge-banner-failed' : ''}`}>
      <div className="arc-bridge-banner-left">
        {isFailed
          ? <div className="arc-bridge-fail-icon">✕</div>
          : <div className="arc-bridge-spinner"/>
        }
        <div>
          <div className="arc-bridge-banner-title">
            {isFailed ? 'Bridge failed' : 'Bridge in progress'} - {bridge.amount} USDC → {toLabel}
          </div>
          <div className="arc-bridge-banner-sub">
            {isFailed ? errText : `${meta.label} · ${elapsed < 1 ? 'just started' : `${elapsed}m ago`} · fast mode ~8-20s`}
          </div>
        </div>
      </div>
      {!isFailed && (
        <div className="arc-bridge-banner-progress">
          <div className="arc-bridge-banner-bar">
            <div className="arc-bridge-banner-fill" style={{ width: `${meta.pct}%` }}/>
          </div>
          <span className="arc-bridge-banner-pct">{meta.pct}%</span>
        </div>
      )}
    </div>
  );
}
