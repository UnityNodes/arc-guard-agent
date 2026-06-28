'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { TokenMark, formatUsd, formatNum } from '@/components/Atoms';
import { useBackendAuth } from '@/hooks/useBackendAuth';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import {
  IconWallet, IconSwap, IconArrowDown, IconSparkle,
  IconCheck, IconCopy, IconExternal, IconDownload, IconUpload, IconFaucet,
  IconChevronDown, IconShield,
} from '@/components/Icons';

// ─── Types ───────────────────────────────────────────────────────────────────
type Balances = { USDC: number; EURC: number };
type WalletData = {
  fullAddress: string;
  balances: Balances;
  maxTxSizeUsd: number;
} | null;
type TxRow = {
  id: string; type: string; detail: string; time: string; timeRel: string;
  hash: string; status: string; explorerUrl: string | null;
  circleTxId: string | null; actionable: boolean;
  amount: string | null; token: string | null; tokenOut: string | null;
};
const PENDING_TX_STATES = new Set(['PENDING', 'IN_PROGRESS', 'SENT', 'QUEUED', 'INITIATED', 'STUCK']);
type WithdrawFeeOption = { feeLevel: 'LOW' | 'MEDIUM' | 'HIGH'; networkFee: string | null; maxFee: string | null; priorityFee: string | null; gasLimit: string | null; baseFee: string | null };
type WithdrawEstimate = {
  fees: { token: string; amount: string; gasToken: string; options: WithdrawFeeOption[] };
  destination: { valid: boolean; blacklisted: boolean; reason?: string };
};
type ApiWallet = { agentAddress: string; balance: { usdc?: string; eurc?: string }; maxTxSizeUsd?: number } | null;
type ApiTx = {
  id: string; type: string; detail?: string;
  tokenIn?: string; tokenOut?: string; amount?: string;
  toAddress?: string; txHash?: string; status?: string;
  createdAt: string;
};

const ARC_EXPLORER = 'https://testnet.arcscan.app';

function mapWallet(w: NonNullable<ApiWallet>): NonNullable<WalletData> {
  const b = w.balance || {};
  return {
    fullAddress: w.agentAddress,
    balances: { USDC: parseFloat(b.usdc || '0'), EURC: parseFloat(b.eurc || '0') },
    maxTxSizeUsd: typeof w.maxTxSizeUsd === 'number' ? w.maxTxSizeUsd : 100,
  };
}
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
function mapTx(t: ApiTx): TxRow {
  const explorerUrl = t.txHash ? `${ARC_EXPLORER}/tx/${t.txHash}` : null;
  const status = (t.status || 'SUCCESS').toUpperCase();
  const circleTxId = t.id.startsWith('circle-') ? t.id.slice('circle-'.length) : null;
  const detail = t.detail ?? (t.tokenIn && t.tokenOut
    ? `${t.tokenIn} → ${t.tokenOut}`
    : t.toAddress ? `→ ${t.toAddress.slice(0, 8)}…` : t.type);
  return {
    id: t.id, type: (t.type || '').toLowerCase(), detail,
    time: new Date(t.createdAt).toLocaleString(),
    timeRel: relativeTime(t.createdAt),
    hash: t.txHash ? `${t.txHash.slice(0, 8)}…${t.txHash.slice(-4)}` : '-',
    status, explorerUrl, circleTxId,
    actionable: circleTxId != null && PENDING_TX_STATES.has(status),
    amount: t.amount ?? null, token: t.tokenIn ?? null, tokenOut: t.tokenOut ?? null,
  };
}
function statusPillClass(status: string): string {
  if (status === 'SUCCESS') return 'ga-pill ga-pill-ok';
  if (status === 'FAILED' || status === 'REJECTED' || status === 'CANCELLED' || status === 'DENIED') return 'ga-pill ga-pill-err';
  if (PENDING_TX_STATES.has(status)) return 'ga-pill ga-pill-warn';
  return 'ga-pill';
}
function readableType(t: string): string {
  if (!t) return '-';
  const map: Record<string, string> = {
    swap: 'Swap', withdraw: 'Send', deposit: 'Deposit', agent: 'Aegis', bridge: 'Bridge',
    transfer: 'Send', receive: 'Receive', faucet: 'Faucet',
  };
  return map[t] ?? t.charAt(0).toUpperCase() + t.slice(1);
}

// ─── Compact token selector ──────────────────────────────────────────────────
function TokenSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const tokens = ['USDC', 'EURC'];
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} className="ga-token-select">
        <TokenMark symbol={value} size={18} />
        <span>{value}</span>
        <IconChevronDown size={11} />
      </button>
      {open && (
        <div className="ga-token-select-menu">
          {tokens.map(t => (
            <button
              key={t}
              onClick={() => { onChange(t); setOpen(false); }}
              className={`ga-token-select-item${value === t ? ' is-active' : ''}`}
            >
              <TokenMark symbol={t} size={16}/> {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Modal shell ─────────────────────────────────────────────────────────────
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="ga-modal-back" onClick={onClose}>
      <div className="ga-modal ga-card ga-card-glow" onClick={e => e.stopPropagation()}>
        <div className="ga-modal-head">
          <div className="ga-modal-title">{title}</div>
          <button className="ga-modal-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function WalletPage() {
  const { ready } = useBackendAuth();
  const toast = useToast();
  const [wallet, setWallet] = useState<WalletData>(null);
  const [txHistory, setTxHistory] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [swapFrom, setSwapFrom] = useState('USDC');
  const [swapTo, setSwapTo] = useState('EURC');
  const [swapAmt, setSwapAmt] = useState('');
  const [copied, setCopied] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [fauceting, setFauceting] = useState(false);
  const [creating, setCreating] = useState(false);

  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [wToken, setWToken] = useState('USDC');
  const [wAmount, setWAmount] = useState('');
  const [wAddress, setWAddress] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [wFeeLevel, setWFeeLevel] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [feePreview, setFeePreview] = useState<WithdrawEstimate | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);

  const [txActionBusy, setTxActionBusy] = useState<string | null>(null);
  const [txFilter, setTxFilter] = useState<string>('all');

  const totalUsd = wallet ? wallet.balances.USDC + wallet.balances.EURC : 0;

  const refreshWallet = useCallback(async (fresh = false) => {
    const res = await api.get<{ wallet: ApiWallet }>(`/agent-wallet${fresh ? '?fresh=1' : ''}`);
    if (res.wallet) {
      const mapped = mapWallet(res.wallet);
      setWallet(mapped);
      return mapped;
    }
    return null;
  }, []);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        const [walletRes, txRes] = await Promise.all([
          api.get<{ wallet: ApiWallet }>('/agent-wallet'),
          api.get<{ transactions: ApiTx[] }>('/agent-wallet/transactions').catch(() => ({ transactions: [] as ApiTx[] })),
        ]);
        if (walletRes.wallet) setWallet(mapWallet(walletRes.wallet));
        setTxHistory((txRes.transactions || []).map(mapTx));
      } catch {
        toast.error('Could not load wallet', 'Refresh to try again');
      } finally { setLoading(false); }
    })();
  }, [ready, toast]);

  useEffect(() => {
    if (!ready) return;
    const refresh = () => { refreshWallet(true).catch(() => {}); };
    const id = setInterval(refresh, 2_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(id); window.removeEventListener('focus', refresh); };
  }, [ready, refreshWallet]);

  const copy = (text?: string) => {
    const v = text ?? wallet?.fullAddress;
    if (!v) return;
    navigator.clipboard.writeText(v).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSwap = async () => {
    if (!wallet || swapping || !swapAmt) return;
    setSwapping(true);
    const t = toast.pending('Swapping…', `${swapAmt} ${swapFrom} → ${swapTo}`);
    try {
      const res = await api.post<{ result?: { txHash?: string } }>('/agent-wallet/swap', {
        fromToken: swapFrom, toToken: swapTo, amount: parseFloat(swapAmt),
      });
      setSwapAmt('');
      await refreshWallet(true);
      t.success('Swap confirmed', `${swapFrom} → ${swapTo}`, res?.result?.txHash ?? null);
    } catch (err) {
      t.error('Swap failed', err instanceof Error ? err.message : undefined);
    } finally { setSwapping(false); }
  };

  const handleFaucet = () => {
    const addr = wallet?.fullAddress;
    if (addr) navigator.clipboard.writeText(addr).catch(() => {});
    setFauceting(true);
    window.open('https://faucet.circle.com', '_blank', 'noopener,noreferrer');
    // The Circle faucet is a manual external flow; poll for the balance to rise
    // instead of a single check, and toast when the USDC actually lands.
    const before = wallet?.balances.USDC ?? 0;
    let attempts = 0;
    const iv = setInterval(async () => {
      attempts += 1;
      let now = before;
      try {
        const fresh = await refreshWallet(true);
        now = fresh?.balances.USDC ?? before;
      } catch { /* keep polling */ }
      if (now > before) {
        toast.success('USDC arrived', `Wallet funded with ${(now - before).toFixed(2)} USDC on Arc`);
        clearInterval(iv); setFauceting(false);
      } else if (attempts >= 18) {
        clearInterval(iv); setFauceting(false);
      }
    }, 5000);
  };

  const handleCreateWallet = async () => {
    if (creating) return;
    setCreating(true);
    const t = toast.pending('Creating agent wallet…', 'Provisioning a Circle DCW on Arc Testnet');
    try {
      const res = await api.post<{ wallet: NonNullable<ApiWallet> }>('/agent-wallet/create', {});
      setWallet(mapWallet(res.wallet));
      t.success('Agent wallet ready', 'You can fund it from Settings → Drop tokens.');
    } catch (err) {
      t.error('Could not create wallet', err instanceof Error ? err.message : undefined);
    } finally { setCreating(false); }
  };

  useEffect(() => {
    if (!showWithdraw) { setFeePreview(null); return; }
    const amt = parseFloat(wAmount);
    if (!amt || amt <= 0 || !/^0x[0-9a-fA-F]{40}$/.test(wAddress)) { setFeePreview(null); return; }
    let cancelled = false;
    setFeeLoading(true);
    const t = setTimeout(() => {
      api.post<WithdrawEstimate>('/agent-wallet/withdraw/estimate', { token: wToken, amount: amt, toAddress: wAddress })
        .then((r) => { if (!cancelled) setFeePreview(r); })
        .catch(() => { if (!cancelled) setFeePreview(null); })
        .finally(() => { if (!cancelled) setFeeLoading(false); });
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [showWithdraw, wToken, wAmount, wAddress]);

  const handleWithdraw = async () => {
    if (!wallet || withdrawing) return;
    const amt = parseFloat(wAmount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(wAddress)) { toast.error('Enter a valid 0x destination address'); return; }
    if (feePreview && (!feePreview.destination.valid || feePreview.destination.blacklisted)) {
      toast.error('Destination not allowed', feePreview.destination.reason ?? undefined); return;
    }
    setWithdrawing(true);
    const t = toast.pending('Sending…', `${amt} ${wToken} to ${wAddress.slice(0, 8)}…${wAddress.slice(-4)}`);
    try {
      const res = await api.post<{ txHash?: string }>('/agent-wallet/withdraw', {
        token: wToken, amount: amt, toAddress: wAddress, feeLevel: wFeeLevel,
      });
      setShowWithdraw(false);
      setWAmount(''); setWAddress('');
      await refreshWallet(true);
      const txRes = await api.get<{ transactions: ApiTx[] }>('/agent-wallet/transactions').catch(() => ({ transactions: [] as ApiTx[] }));
      setTxHistory((txRes.transactions || []).map(mapTx));
      t.success('Send confirmed', `${amt} ${wToken} on its way`, res?.txHash ?? null);
    } catch (err) {
      t.error('Send failed', err instanceof Error ? err.message : undefined);
    } finally { setWithdrawing(false); }
  };

  const refreshTxHistory = useCallback(async () => {
    const txRes = await api.get<{ transactions: ApiTx[] }>('/agent-wallet/transactions').catch(() => ({ transactions: [] as ApiTx[] }));
    setTxHistory((txRes.transactions || []).map(mapTx));
  }, []);

  const handleTxAction = async (circleTxId: string, action: 'accelerate' | 'cancel') => {
    if (txActionBusy) return;
    setTxActionBusy(`${circleTxId}:${action}`);
    const verb = action === 'accelerate' ? 'Speeding up' : 'Cancelling';
    const t = toast.pending(`${verb}…`, `Circle tx ${circleTxId.slice(0, 8)}…`);
    try {
      await api.post(`/agent-wallet/transactions/${circleTxId}/${action}`, {});
      await refreshTxHistory();
      await refreshWallet(true);
      t.success(action === 'accelerate' ? 'Speed-up requested' : 'Cancellation requested', `Circle tx ${circleTxId.slice(0, 8)}…`);
    } catch (err) {
      t.error(action === 'accelerate' ? 'Speed-up failed' : 'Cancel failed', err instanceof Error ? err.message : undefined);
    } finally { setTxActionBusy(null); }
  };

  // ─── Loading state ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="arc-page" style={{ alignItems: 'center', justifyContent: 'center', minHeight: 240 }}>
        <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading wallet…</span>
      </div>
    );
  }

  // ─── Empty state ─────────────────────────────────────────────────────────
  if (!wallet) {
    return (
      <div className="arc-page">
        <div className="arc-card" style={{ maxWidth: 520 }}>
          <div className="arc-card-head">
            <span className="arc-card-title"><IconWallet size={13}/> Agent Wallet</span>
          </div>
          <div style={{ padding: '28px 18px', textAlign: 'center' }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,150,72,0.10)', color: 'var(--amber-300)', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>
              <IconShield size={20}/>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 8 }}>No agent wallet yet</div>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 20 }}>
              A Circle Developer-Controlled Wallet on Arc Testnet. Non-custodial - the agent gets a delegated signing key.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="arc-btn arc-btn-primary" onClick={handleCreateWallet} disabled={creating}>
                <IconWallet size={13}/> {creating ? 'Creating…' : 'Create agent wallet'}
              </button>
              <a className="arc-btn arc-btn-secondary" href="https://developers.circle.com/w3s/programmable-wallets" target="_blank" rel="noopener noreferrer">
                Docs <IconExternal size={11}/>
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const usdc = wallet.balances.USDC;
  const eurc = wallet.balances.EURC;
  const filteredTx = txFilter === 'all' ? txHistory : txHistory.filter(t => t.type === txFilter);

  return (
    <div className="arc-page">

      {/* Action bar: address + balance summary + quick actions */}
      <div className="arc-action-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', background: 'var(--bg-3)', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line-1)' }}>
            {wallet.fullAddress.slice(0, 10)}…{wallet.fullAddress.slice(-6)}
          </span>
          <button className="arc-link-btn" onClick={() => copy()} style={copied ? { color: 'var(--ok)' } : undefined}>
            {copied ? <IconCheck size={11}/> : <IconCopy size={11}/>}
          </button>
          <a className="arc-link-btn" href={`${ARC_EXPLORER}/address/${wallet.fullAddress}`} target="_blank" rel="noopener noreferrer">
            <IconExternal size={11}/>
          </a>
          <span className="ga-pill ga-pill-ok" style={{ fontSize: 10 }}>
            <span className="ga-status-orb" style={{ width: 5, height: 5 }}/> Arc Testnet
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
            {formatUsd(totalUsd)}
          </span>
          <button className="arc-btn arc-btn-secondary" onClick={() => setShowDeposit(true)}>
            <IconDownload size={12}/> Deposit
          </button>
          <button className="arc-btn arc-btn-secondary" onClick={() => setShowWithdraw(true)}>
            <IconUpload size={12}/> Send
          </button>

        </div>
      </div>

      {/* KPI tiles: per-token balances */}
      <div className="arc-kpi-row">
        <div className="arc-kpi">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <TokenMark symbol="USDC" size={14}/>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>USDC</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink-1)', fontVariantNumeric: 'tabular-nums' }}>{formatNum(usdc)}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>Circle USD · gas token</div>
        </div>
        <div className="arc-kpi">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <TokenMark symbol="EURC" size={14}/>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>EURC</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink-1)', fontVariantNumeric: 'tabular-nums' }}>{formatNum(eurc)}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>Circle EUR stablecoin</div>
        </div>
        <div className="arc-kpi">
          <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Total</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink-1)', fontVariantNumeric: 'tabular-nums' }}>{formatUsd(totalUsd)}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>per-tx cap {formatUsd(wallet.maxTxSizeUsd)}</div>
        </div>
      </div>

      {/* Swap widget - kept in arc-card, inner widget classes preserved */}
      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconSwap size={13}/> Stablecoin FX</span>
          <span className="ga-pill ga-pill-ok" style={{ fontSize: 10 }}><span className="ga-pill-dot"/> Arc · ~1s</span>
        </div>

        <div style={{ padding: '14px 18px' }}>
          <div className="ga-swap-hero-body">
            <div className="ga-swap-side ga-swap-hero-side">
              <div className="ga-swap-side-head">
                <span>You pay</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>Balance: <span className="ga-mono-num" style={{ color: 'var(--ink-2)' }}>{formatNum(wallet.balances[swapFrom as keyof Balances] || 0)}</span></span>
                  {(wallet.balances[swapFrom as keyof Balances] || 0) > 0 && (
                    <button className="ga-max-btn" onClick={() => setSwapAmt(String(wallet.balances[swapFrom as keyof Balances] || 0))}>MAX</button>
                  )}
                </div>
              </div>
              <div className="ga-swap-row">
                <input className="ga-swap-input ga-swap-input-hero" placeholder="0.00" value={swapAmt} onChange={e => setSwapAmt(e.target.value)}/>
                <TokenSelect value={swapFrom} onChange={v => { if (v !== swapTo) setSwapFrom(v); }}/>
              </div>
            </div>

            <button className="ga-swap-mid ga-swap-mid-hero" onClick={() => { const tmp = swapFrom; setSwapFrom(swapTo); setSwapTo(tmp); }}>
              <IconSwap size={14}/>
            </button>

            <div className="ga-swap-side ga-swap-hero-side">
              <div className="ga-swap-side-head">
                <span>You receive</span>
                <span>Balance: <span className="ga-mono-num" style={{ color: 'var(--ink-2)' }}>{formatNum(wallet.balances[swapTo as keyof Balances] || 0)}</span></span>
              </div>
              <div className="ga-swap-row">
                <div className="ga-swap-input ga-swap-input-hero" style={{ color: swapAmt ? 'var(--ink-1)' : 'var(--ink-4)' }}>{swapAmt || '0.00'}</div>
                <TokenSelect value={swapTo} onChange={v => { if (v !== swapFrom) setSwapTo(v); }}/>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <button
              className="arc-btn arc-btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={swapping || !swapAmt}
              onClick={handleSwap}
            >
              <IconSwap size={13}/> {swapping ? 'Swapping…' : `Swap ${swapFrom} → ${swapTo}`}
            </button>
          </div>
        </div>
      </div>

      {/* Wallet identity */}
      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconWallet size={13}/> Wallet identity</span>
          <a className="arc-link-btn" href={`${ARC_EXPLORER}/address/${wallet.fullAddress}`} target="_blank" rel="noopener noreferrer">
            Explorer <IconExternal size={11}/>
          </a>
        </div>
        <div style={{ padding: '0 18px 14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Address</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-1)' }}>{wallet.fullAddress.slice(0, 10)}…{wallet.fullAddress.slice(-8)}</span>
              <button className="arc-link-btn" onClick={() => copy()} style={copied ? { color: 'var(--ok)' } : undefined}>
                {copied ? <IconCheck size={11}/> : <IconCopy size={11}/>}
              </button>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Network</div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-1)' }}>
              <span className="ga-status-orb" style={{ width: 7, height: 7 }}/> Arc Testnet
            </span>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Type</div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-1)' }}>Circle DCW</span>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Per-tx cap</div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-1)' }}>{formatUsd(wallet.maxTxSizeUsd)}</span>
          </div>
        </div>
      </div>

      {/* Transaction history */}
      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconSparkle size={13}/> Transactions</span>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{txHistory.length} total</span>
        </div>

        <div style={{ padding: '0 18px 10px' }}>
          <div className="arc-tab-bar">
            {['all', 'swap', 'withdraw', 'deposit', 'agent', 'bridge'].map(f => (
              <button
                key={f}
                className={`arc-tab${txFilter === f ? ' arc-tab-active' : ''}`}
                onClick={() => setTxFilter(f)}
              >
                {f === 'all' ? 'All' : readableType(f)}
              </button>
            ))}
          </div>
        </div>

        {filteredTx.length === 0 ? (
          <div className="arc-empty">No transactions yet.</div>
        ) : (
          <div className="arc-table-wrap">
            <table className="arc-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Detail</th>
                  <th>Amount</th>
                  <th>Hash</th>
                  <th>Status</th>
                  <th>Time</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredTx.map(tx => (
                  <tr key={tx.id}>
                    <td style={{ fontWeight: 500 }}>{readableType(tx.type)}</td>
                    <td style={{ color: 'var(--ink-3)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.detail}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {tx.amount ? `${tx.amount}${tx.token ? ' ' + tx.token : ''}` : '-'}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {tx.explorerUrl ? (
                        <a href={tx.explorerUrl} target="_blank" rel="noopener noreferrer" className="arc-link-btn" style={{ gap: 4 }}>
                          {tx.hash} <IconExternal size={10}/>
                        </a>
                      ) : tx.hash}
                    </td>
                    <td><span className={statusPillClass(tx.status)}>{tx.status}</span></td>
                    <td style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{tx.timeRel}</td>
                    <td>
                      {tx.actionable && tx.circleTxId && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="arc-btn arc-btn-secondary"
                            style={{ fontSize: 10, padding: '2px 8px' }}
                            disabled={!!txActionBusy}
                            onClick={() => handleTxAction(tx.circleTxId!, 'accelerate')}
                          >
                            Speed up
                          </button>
                          <button
                            className="arc-btn arc-btn-secondary"
                            style={{ fontSize: 10, padding: '2px 8px', color: 'var(--err)' }}
                            disabled={!!txActionBusy}
                            onClick={() => handleTxAction(tx.circleTxId!, 'cancel')}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Deposit modal */}
      {showDeposit && (
        <ModalShell title="Deposit to agent wallet" onClose={() => setShowDeposit(false)}>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 14 }}>
            Send USDC or EURC to this address on <strong style={{ color: 'var(--ink-1)' }}>Arc Testnet</strong>. Need test funds? Use the Circle faucet.
          </p>
          <div className="ga-section-label" style={{ marginBottom: 6 }}>Wallet address</div>
          <div className="ga-addr-row" style={{ marginBottom: 14 }}>
            <span className="ga-addr-row-value">{wallet.fullAddress}</span>
            <button className="ga-addr-row-icon" onClick={() => copy(wallet.fullAddress)} style={copied ? { color: 'var(--ok)' } : undefined}>
              {copied ? <IconCheck size={13}/> : <IconCopy size={13}/>}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="arc-btn arc-btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={handleFaucet} disabled={fauceting}>
              <IconFaucet size={13}/> {fauceting ? 'Opening…' : 'Open faucet'}
            </button>
            <a className="arc-btn arc-btn-secondary" style={{ flex: 1, justifyContent: 'center' }} href={`${ARC_EXPLORER}/address/${wallet.fullAddress}`} target="_blank" rel="noopener noreferrer">
              <IconExternal size={13}/> Explorer
            </a>
          </div>
        </ModalShell>
      )}

      {/* Withdraw modal */}
      {showWithdraw && (
        <ModalShell title="Send from agent wallet" onClose={() => setShowWithdraw(false)}>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 16 }}>
            Withdrawals run compliance screening + Guardian policy. Per-tx limit: <span className="ga-mono-num" style={{ color: 'var(--ink-1)' }}>{formatUsd(wallet.maxTxSizeUsd)}</span>.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="ga-section-label" style={{ marginBottom: 6 }}>Token</div>
              <TokenSelect value={wToken} onChange={setWToken}/>
            </div>
            <div>
              <div className="ga-section-label" style={{ marginBottom: 6 }}>Amount</div>
              <input className="ga-input" placeholder="0.00" value={wAmount} onChange={e => setWAmount(e.target.value)}/>
              <div className="ga-meta" style={{ marginTop: 4 }}>
                Available: <span className="ga-mono-num" style={{ color: 'var(--ink-2)' }}>{formatNum(wallet.balances[wToken as keyof Balances] || 0)}</span> {wToken}
              </div>
            </div>
            <div>
              <div className="ga-section-label" style={{ marginBottom: 6 }}>Destination address</div>
              <input className="ga-input ga-input-mono" placeholder="0x…" value={wAddress} onChange={e => setWAddress(e.target.value)}/>
            </div>
            <div>
              <div className="ga-section-label" style={{ marginBottom: 6 }}>
                Network fee {feeLoading && <span style={{ color: 'var(--ink-3)' }}>· estimating…</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['LOW', 'MEDIUM', 'HIGH'] as const).map((lvl) => {
                  const opt = feePreview?.fees.options.find((o) => o.feeLevel === lvl);
                  const active = wFeeLevel === lvl;
                  return (
                    <button key={lvl} onClick={() => setWFeeLevel(lvl)} className={`ga-fee-btn${active ? ' is-active' : ''}`}>
                      <span className="ga-fee-btn-label">{lvl === 'LOW' ? 'Slow' : lvl === 'MEDIUM' ? 'Normal' : 'Fast'}</span>
                      <span className="ga-fee-btn-val">
                        {opt?.networkFee != null ? `~${parseFloat(opt.networkFee).toFixed(4)} USDC` : '-'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            {feePreview && (!feePreview.destination.valid || feePreview.destination.blacklisted) && (
              <div className="ga-inline-err">{feePreview.destination.reason ?? 'Destination address is not allowed for this token.'}</div>
            )}
            <button
              className="arc-btn arc-btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={withdrawing || feeLoading || (!!feePreview && (!feePreview.destination.valid || feePreview.destination.blacklisted))}
              onClick={handleWithdraw}
            >
              <IconUpload size={13}/> {withdrawing ? 'Submitting…' : 'Send'}
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
