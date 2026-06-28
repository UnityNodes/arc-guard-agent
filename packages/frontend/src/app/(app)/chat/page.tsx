'use client';
import React, { useState, useRef, useEffect, useMemo, Fragment } from 'react';
import { IconPlus, IconSend, IconWallet, IconCheck, IconCopy } from '@/components/Icons';
import { BrandMark } from '@/components/Icons';
import { formatUsd } from '@/components/Atoms';
import { useBackendAuth } from '@/hooks/useBackendAuth';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/toast';

const ARC_EXPLORER = 'https://testnet.arcscan.app';

const DEST_EXPLORERS: Record<string, string> = {
  'base-sepolia':     'https://sepolia.basescan.org',
  'ethereum-sepolia': 'https://sepolia.etherscan.io',
  'arbitrum-sepolia': 'https://sepolia.arbiscan.io',
};

function destExplorerTxUrl(toChain: string | null | undefined, hash: string): string {
  const base = DEST_EXPLORERS[toChain ?? ''] ?? '';
  return base ? `${base}/tx/${hash}` : `https://www.google.com/search?q=${hash}`;
}

// ─── Tool catalog ────────────────────────────────────────────────────────────
const TOOL_LABELS: Record<string, string> = {
  get_wallet_balances: 'Checked balances',
  find_token: 'Looked up token',
  check_token_safety: 'Token safety check',
  show_amount_options: 'Suggested amounts',
  update_settings: 'Updated settings',
  update_guardrails: 'Updated guardrails',
  create_price_rule: 'Created alert',
  get_swap_quote: 'Got swap quote',
  execute_swap: 'Swapped tokens',
  create_limit_order: 'Created limit order',
  list_limit_orders: 'Listed limit orders',
  cancel_limit_order: 'Cancelled limit order',
  create_dca_order: 'Created DCA',
  list_dca_orders: 'Listed DCA orders',
  manage_dca_order: 'Managed DCA',
  earn_info: 'Earn vault info',
  earn_deposit: 'Deposited to Earn',
  earn_withdraw: 'Withdrew from Earn',
  gateway_balance: 'Gateway balance',
  gateway_deposit: 'Gateway deposit',
  gateway_spend: 'Gateway spend',
  list_bridge_chains: 'Listed bridge chains',
  get_bridge_quote: 'Bridge quote',
  execute_bridge: 'Bridged USDC',
  get_bridge_progress: 'Bridge progress',
  send_usdc: 'Sent USDC',
  list_my_jobs: 'Listed jobs',
  create_job: 'Created job',
  set_job_budget: 'Set budget',
  fund_job: 'Funded escrow',
  submit_job_deliverable: 'Submitted deliverable',
  complete_job: 'Released USDC',
  get_job_status: 'Checked job status',
  aegis_search_marketplace: 'Searched marketplace',
  aegis_buy_data: 'Bought data feed',
};
function prettyToolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
type BadgeKind = 'success' | 'pending' | 'error';
function toolBadgeKind(t: ToolTrace): BadgeKind {
  if (t.ok === false) return 'error';
  const s = (t.summary ?? '').toLowerCase();
  if (s.includes('approval') || s.includes('blocked') || s.includes('pending')) return 'pending';
  return 'success';
}
const BADGE_STYLE: Record<BadgeKind, { bg: string; fg: string; border: string }> = {
  success: { bg: 'rgba(78,214,192,0.10)', fg: 'var(--ok)', border: 'rgba(78,214,192,0.28)' },
  pending: { bg: 'rgba(220,170,40,0.13)', fg: '#ddcc44', border: 'rgba(220,170,40,0.32)' },
  error:   { bg: 'rgba(255,90,90,0.10)',  fg: 'var(--err)', border: 'rgba(255,90,90,0.28)' },
};

// ─── Markdown w/ tx-hash auto-pill ───────────────────────────────────────────
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, li) => {
    const parts: React.ReactNode[] = [];
    // Order matters: longer patterns first (txHash before link/bold to avoid swallowing)
    const re = /(0x[a-fA-F0-9]{64})|(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(\*\*(.+?)\*\*)|(_(.+?)_)|(`([^`]+)`)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let ki = 0;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      if (m[1]) {
        parts.push(<TxHashPill key={ki++} hash={m[1]} />);
      } else if (m[2]) {
        parts.push(<a key={ki++} href={m[4]} target="_blank" rel="noopener noreferrer" className="chat-link">{m[3]}</a>);
      } else if (m[5]) {
        parts.push(<strong key={ki++}>{m[6]}</strong>);
      } else if (m[7]) {
        parts.push(<em key={ki++}>{m[8]}</em>);
      } else if (m[9]) {
        parts.push(<code key={ki++} className="chat-inline-code">{m[10]}</code>);
      }
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return (
      <Fragment key={li}>
        {parts.length > 0 ? parts : line}
        {li < lines.length - 1 && '\n'}
      </Fragment>
    );
  });
}

function TxHashPill({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  const truncated = `${hash.slice(0, 8)}…${hash.slice(-6)}`;
  return (
    <span className="tx-pill">
      <a href={`${ARC_EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer" className="tx-pill-hash" title={hash}>
        {truncated}
      </a>
      <button
        type="button"
        className="tx-pill-copy"
        onClick={(e) => {
          e.preventDefault();
          navigator.clipboard.writeText(hash);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        title="Copy hash"
      >
        {copied ? <IconCheck size={9} /> : <IconCopy size={9} />}
      </button>
    </span>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────
type Thread = { id: string; title: string; lastMessageAt: string };
type ApiMessage = { id: string; role: string; content: string; actions: unknown; createdAt: string };
interface ToolTrace { name: string; ok?: boolean; summary?: string; cost?: string; input?: Record<string, unknown> }
type Msg =
  | { role: 'agent'; kind: 'text'; text: string; toolsUsed?: ToolTrace[] }
  | { role: 'you'; text: string };

function msgFromApi(m: ApiMessage): Msg {
  if (m.role === 'user') return { role: 'you', text: m.content };
  return { role: 'agent', kind: 'text', text: m.content };
}
function formatThreadTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 2) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Quick-action suggestions: parsed from agent's last reply ────────────────
type QuickAction = { label: string; send: string; form?: 'bridge' | 'swap' };
function suggestionsForReply(text: string): QuickAction[] {
  const t = text.toLowerCase();
  const out: QuickAction[] = [];

  // ── Job flow ──────────────────────────────────────────────────────────────
  if (/(next( step)?:.*\bset (the )?budget|set the budget as the provider)/i.test(t)) {
    out.push({ label: 'Set budget · 1 USDC', send: 'Set the budget to 1 USDC.' });
    out.push({ label: 'Set budget · 5 USDC', send: 'Set the budget to 5 USDC.' });
    return out;
  }
  if (/(next( step)?:.*\bfund|fund the job as the client|fund the escrow)/i.test(t)) {
    out.push({ label: 'Fund it', send: 'Fund the job.' });
    return out;
  }
  if (/(next( step)?:.*\bsubmit|submit a deliverable|as provider)/i.test(t)) {
    out.push({ label: 'Submit "done"', send: 'Submit a deliverable with text "done".' });
    return out;
  }
  if (/(?:next( step)?:.*\bcomplete|complete the job|as evaluator|release the)/i.test(t)) {
    out.push({ label: 'Approve & settle', send: 'Complete the job with reason "approved".' });
    return out;
  }

  // ── Execution confirmation ────────────────────────────────────────────────
  if (/should i execute|should i (proceed|submit|send|bridge|swap)|confirm.*to (proceed|execute)|ready to (execute|bridge|swap)|want me to (execute|proceed|send|bridge|swap)|shall i/i.test(t)) {
    out.push({ label: 'Yes, execute', send: 'Yes, execute.' });
    out.push({ label: 'Cancel', send: 'Cancel that.' });
    return out;
  }

  // ── Swap direction choice ─────────────────────────────────────────────────
  if (/opposite direction|eurc.*usdc.*instead|swap.*instead|try.*other direction/i.test(t)) {
    out.push({ label: 'Yes, try EURC → USDC', send: 'Yes, swap EURC to USDC instead.' });
    out.push({ label: 'Skip', send: 'No, skip the swap.' });
    return out;
  }

  // ── Generic yes/no question (ends with ?) ─────────────────────────────────
  if (/\?\s*$/.test(t.trim()) && /\b(do you|would you|want|shall|should|can i|will you)\b/i.test(t)) {
    out.push({ label: 'Yes', send: 'Yes.' });
    out.push({ label: 'No', send: 'No.' });
    return out;
  }

  // ── Bridge - agent mentions bridge but hasn't executed it → show form ───────
  // Exclude: bridge already submitted/complete/failed (those have their own tracker)
  if (/bridge/i.test(t) && !/bridge submitted|bridge id|bridge complete|bridge failed|bridging usdc across/i.test(t)) {
    out.push({ label: 'Bridge USDC', send: '', form: 'bridge' });
    return out;
  }

  // ── Retry / different amount ──────────────────────────────────────────────
  if (/try a different amount|different amount|try again/i.test(t)) {
    out.push({ label: 'Try 1 USDC', send: 'Try with 1 USDC.' });
    out.push({ label: 'Try 5 USDC', send: 'Try with 5 USDC.' });
    return out;
  }

  return out;
}

// ─── Tool-in-progress label (used in thinking state) ─────────────────────────
function inferRunningTool(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (/\bfund(ing)?\b/.test(t)) return 'Funding the escrow…';
  if (/\bsubmit/.test(t)) return 'Submitting deliverable…';
  if (/\bcomplet/.test(t)) return 'Releasing USDC from escrow…';
  if (/\bbridg/.test(t)) return 'Bridging USDC across chains…';
  if (/\bswap/.test(t)) return 'Quoting & swapping tokens…';
  if (/\bsend\b.*usdc|\busdc\b.*send/.test(t)) return 'Sending USDC…';
  if (/\b(create|set).*job/.test(t) || /\bjob\b/.test(t)) return 'Calling job contract on Arc…';
  if (/\bbalance|status|list|show/.test(t)) return 'Reading state…';
  return null;
}

// ─── Bridge inline progress tracker ──────────────────────────────────────────
const BRIDGE_STEPS = [
  { key: 'PENDING',    label: 'Submitting burn tx',       pct: 15 },
  { key: 'SUBMITTED',  label: 'Burn confirmed on Arc',    pct: 38 },
  { key: 'ATTESTING',  label: 'Circle attesting…',        pct: 62 },
  { key: 'MINTING',    label: 'Minting on destination',   pct: 85 },
  { key: 'SUCCESS',    label: 'Complete',                 pct: 100 },
  { key: 'FAILED',     label: 'Failed',                   pct: 0 },
];

function friendlyBridgeError(raw: string | null | undefined): { title: string; hint: string } {
  if (!raw) return { title: 'Bridge failed', hint: 'Try again or use a different amount.' };
  const r = raw.toLowerCase();
  if (r.includes('max fee must be less than amount') || r.includes('fee') && r.includes('amount'))
    return { title: 'Fee exceeds amount', hint: 'The network fee is larger than what you\'re sending. Try bridging 5+ USDC.' };
  if (r.includes('simulation failed'))
    return { title: 'Transaction simulation failed', hint: 'Arc Testnet rejected the tx. Try a larger amount or wait a moment.' };
  if (r.includes('insufficient') || r.includes('balance'))
    return { title: 'Insufficient balance', hint: 'Not enough USDC to cover amount + fees.' };
  if (r.includes('timeout') || r.includes('timed out') || r.includes('restarted'))
    return { title: 'Bridge timed out', hint: 'The process was interrupted. Your funds are safe - check your balance.' };
  if (r.includes('unsupported') || r.includes('route'))
    return { title: 'Route not supported', hint: 'This chain pair is not available right now.' };
  return { title: 'Bridge failed', hint: raw.length < 120 ? raw : 'An unexpected error occurred. Try again.' };
}

interface BridgeRecord {
  status: string;
  error?: string | null;
  txHash?: string | null;
  destinationTxHash?: string | null;
  toChain?: string | null;
  amount?: string | null;
}

const BRIDGE_TOAST_STEP: Record<string, { title: string; desc: (toChain?: string | null) => string }> = {
  PENDING:   { title: 'Submitting burn on Arc',  desc: () => 'Approving and burning USDC via CCTP' },
  SUBMITTED: { title: 'Burn confirmed on Arc',   desc: () => 'Waiting for Circle attestation - up to a few minutes on testnet' },
  ATTESTING: { title: 'Circle attesting',        desc: () => 'Signing the cross-chain proof - this can take a few minutes on testnet' },
  MINTING:   { title: 'Minting on destination',  desc: (c) => `Releasing USDC on ${c ?? 'destination'}` },
};

function BridgeChatTracker({ bridgeId }: { bridgeId: string }) {
  const [status, setStatus] = useState('PENDING');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [burnTx, setBurnTx] = useState<string | null>(null);
  const [mintTx, setMintTx] = useState<string | null>(null);
  const [toChain, setToChain] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const toast = useToast();
  const toastHandleRef = useRef<ReturnType<typeof toast.pending> | null>(null);
  const lastStepRef = useRef<string | null>(null);
  const settledRef = useRef(false);
  const failuresRef = useRef(0);

  // Dismiss an unfinished pending toast only on a real unmount (user navigates
  // away mid-bridge), so it does not hang forever. Success/Failed self-dismiss.
  useEffect(() => () => {
    if (!settledRef.current) toastHandleRef.current?.dismiss();
  }, []);

  useEffect(() => {
    if (done) return;
    if (!toastHandleRef.current) {
      toastHandleRef.current = toast.pending('Bridge starting', 'Submitting burn on Arc');
      lastStepRef.current = 'PENDING';
    }
    const handle = toastHandleRef.current;
    const poll = async () => {
      try {
        const r = await api.get<BridgeRecord>(`/bridge/${bridgeId}`);
        failuresRef.current = 0;
        const s = (r.status || 'PENDING').toUpperCase();
        setStatus(s);
        if (r.error) setErrorMsg(r.error);
        if (r.txHash) setBurnTx(r.txHash);
        if (r.destinationTxHash) setMintTx(r.destinationTxHash);
        if (r.toChain) setToChain(r.toChain);

        if (s !== lastStepRef.current) {
          lastStepRef.current = s;
          if (s === 'SUCCESS') {
            settledRef.current = true;
            handle.success(
              'Bridge complete',
              `${r.amount ?? 'USDC'} minted on ${r.toChain ?? 'destination'}`,
              r.destinationTxHash || r.txHash || null,
            );
            setDone(true);
          } else if (s === 'FAILED') {
            settledRef.current = true;
            handle.error('Bridge failed', r.error || 'Check the activity log for details');
            setDone(true);
          } else {
            const step = BRIDGE_TOAST_STEP[s];
            if (step) handle.update({ type: 'pending', title: step.title, description: step.desc(r.toChain), persistent: true });
          }
        }
      } catch {
        // After ~2.5 min of unreachable status, stop spinning and tell the user
        // where to look instead of leaving a pending toast forever.
        failuresRef.current += 1;
        if (failuresRef.current >= 30) {
          settledRef.current = true;
          handle.info('Bridge status unavailable', 'Lost connection to the tracker. Check Activity for the final result.');
          setDone(true);
        }
      }
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, [bridgeId, done, toast]);

  const step = BRIDGE_STEPS.find(s => s.key === status) ?? BRIDGE_STEPS[0];
  const isFailed = status === 'FAILED';
  const isSuccess = status === 'SUCCESS';
  const color = isFailed ? 'var(--err)' : isSuccess ? 'var(--ok)' : 'var(--amber-400)';
  const errInfo = isFailed ? friendlyBridgeError(errorMsg) : null;

  return (
    <div style={{
      marginTop: 8, padding: '10px 14px',
      background: isFailed ? 'var(--err-soft)' : isSuccess ? 'var(--ok-soft)' : 'color-mix(in oklab, var(--amber-400) 8%, var(--bg-2))',
      border: `1px solid ${isFailed ? 'rgba(185,28,28,0.25)' : isSuccess ? 'rgba(26,127,75,0.25)' : 'color-mix(in oklab, var(--amber-400) 30%, var(--line-1))'}`,
      borderRadius: 'var(--r-md)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isFailed ? 4 : 6 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color, display: 'flex', alignItems: 'center', gap: 6 }}>
          {!isSuccess && !isFailed && (
            <span style={{ width: 10, height: 10, border: `2px solid ${color}`, borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'arc-spin 0.8s linear infinite', flexShrink: 0 }}/>
          )}
          {isSuccess && '✓ '}
          {isFailed && '✕ '}
          {isFailed ? (errInfo?.title ?? 'Bridge failed') : step.label}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color, fontWeight: 600 }}>
          {isFailed ? 'FAILED' : `${step.pct}%`}
        </span>
      </div>
      {isFailed && errInfo?.hint && (
        <div style={{ fontSize: 11, color: 'var(--err)', opacity: 0.8, marginBottom: 4 }}>
          {errInfo.hint}
        </div>
      )}
      {!isFailed && (
        <div style={{ height: 4, background: 'var(--bg-3)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${step.pct}%`, background: color, borderRadius: 2, transition: 'width 0.6s ease' }}/>
        </div>
      )}
      {!isSuccess && !isFailed && (status === 'ATTESTING' || status === 'SUBMITTED' || status === 'MINTING') && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--ink-4)' }}>
          Circle attestation can take a few minutes on testnet - your USDC is safe and will arrive.
        </div>
      )}
      {(burnTx || mintTx) && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11 }}>
          {burnTx && (
            <a
              href={`${ARC_EXPLORER}/tx/${burnTx}`}
              target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--accent)', textDecoration: 'underline', fontFamily: 'var(--font-mono)' }}
            >
              Arc burn ↗ {burnTx.slice(0, 10)}…
            </a>
          )}
          {mintTx && (
            <a
              href={destExplorerTxUrl(toChain, mintTx)}
              target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--accent)', textDecoration: 'underline', fontFamily: 'var(--font-mono)' }}
            >
              {toChain ?? 'Dest'} mint ↗ {mintTx.slice(0, 10)}…
            </a>
          )}
        </div>
      )}
      <div style={{ marginTop: 5, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)' }}>
        bridge id: {bridgeId.slice(0, 20)}…
      </div>
    </div>
  );
}

// ─── Action forms (bridge / swap) ────────────────────────────────────────────
const BRIDGE_CHAINS = [
  { id: 'base-sepolia',     label: 'Base Sepolia' },
  { id: 'ethereum-sepolia', label: 'Ethereum Sepolia' },
];

function BridgeForm({ onSend, onCancel }: { onSend: (cmd: string) => void; onCancel: () => void }) {
  const [chain, setChain] = useState(BRIDGE_CHAINS[0].id);
  const [amount, setAmount] = useState('1');
  const chainLabel = BRIDGE_CHAINS.find(c => c.id === chain)?.label ?? chain;
  const submit = () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    onSend(`Bridge ${n} USDC to ${chain}.`);
  };
  return (
    <div style={{ marginTop: 10, padding: '14px 16px', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-md)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-1)', letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'var(--font-sans)' }}>
        Bridge USDC
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
          <label style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>Amount (USDC)</label>
          <input
            className="arc-input arc-input-sm"
            style={{ fontFamily: 'var(--font-mono)' }}
            type="number" min="0.01" step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1.5 }}>
          <label style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>Destination</label>
          <select className="arc-select arc-input-sm" value={chain} onChange={e => setChain(e.target.value)}>
            {BRIDGE_CHAINS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="arc-btn arc-btn-primary" style={{ fontSize: 12, padding: '6px 14px' }} onClick={submit}>
          Bridge {amount || '?'} USDC → {chainLabel}
        </button>
        <button className="arc-btn arc-btn-secondary" style={{ fontSize: 12, padding: '6px 10px' }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function SwapForm({ onSend, onCancel }: { onSend: (cmd: string) => void; onCancel: () => void }) {
  const [from, setFrom] = useState('USDC');
  const [amount, setAmount] = useState('2');
  const to = from === 'USDC' ? 'EURC' : 'USDC';
  const submit = () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    onSend(`Swap ${n} ${from} to ${to}.`);
  };
  return (
    <div style={{ marginTop: 10, padding: '14px 16px', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-md)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-1)', letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'var(--font-sans)' }}>
        Swap stablecoins
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
          <label style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>Amount</label>
          <input
            className="arc-input arc-input-sm"
            style={{ fontFamily: 'var(--font-mono)' }}
            type="number" min="0.01" step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
          <label style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>From</label>
          <select className="arc-select arc-input-sm" value={from} onChange={e => setFrom(e.target.value)}>
            <option value="USDC">USDC</option>
            <option value="EURC">EURC</option>
          </select>
        </div>
        <div style={{ paddingTop: 16, color: 'var(--ink-3)', fontSize: 16 }}>→</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
          <label style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>To</label>
          <div className="arc-input arc-input-sm" style={{ background: 'var(--bg-3)', fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>{to}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="arc-btn arc-btn-primary" style={{ fontSize: 12, padding: '6px 14px' }} onClick={submit}>
          Swap {amount || '?'} {from} → {to}
        </button>
        <button className="arc-btn arc-btn-secondary" style={{ fontSize: 12, padding: '6px 10px' }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Message ─────────────────────────────────────────────────────────────────
function ChatMessage({ m, isLast, onQuickAction }: { m: Msg; isLast: boolean; onQuickAction: (text: string) => void }) {
  const [inlineForm, setInlineForm] = useState<'bridge' | 'swap' | null>(null);

  if (m.role === 'you') {
    return (
      <div className="chat-msg-row chat-msg-you">
        <div className="chat-bubble-you">{m.text}</div>
      </div>
    );
  }
  const isSanitized = m.text.startsWith('⚠️');
  const quick = isLast ? suggestionsForReply(m.text) : [];

  // Extract bridge ID → show live progress tracker inline.
  // Prisma CUID2 starts with a lowercase letter then 23 chars [a-z0-9]; the prefix
  // (cm*) rolls forward over time (cmp, cmq, cmr...) so do not pin the second letter.
  const bridgeIdMatch = m.text.match(/ID:\s*`?(c[a-z0-9]{23,})`?/i)
    ?? m.text.match(/\((c[a-z0-9]{23,})\)/i)
    ?? m.text.match(/\b(c[a-z0-9]{23,})\b/);
  const bridgeId = bridgeIdMatch?.[1] ?? null;

  const handleQuickClick = (q: QuickAction) => {
    if (q.form) { setInlineForm(q.form); return; }
    if (q.send) onQuickAction(q.send);
  };

  return (
    <div className="chat-msg-row chat-msg-agent">
      <div className="chat-agent-orb">
        <span className="chat-agent-orb-inner" />
      </div>
      <div className="chat-msg-stack">
        <div className="chat-agent-label">
          <span className="chat-agent-name">Aegis</span>
          <span className="chat-agent-meta">on-chain agent · Arc</span>
        </div>
        {m.kind === 'text' && m.toolsUsed && m.toolsUsed.length > 0 && (
          <div className="chat-tools-row">
            {m.toolsUsed.map((t, i) => {
              const kind = toolBadgeKind(t);
              const style = BADGE_STYLE[kind];
              const label = prettyToolLabel(t.name);
              const tooltip = `${t.name}${t.summary ? ` · ${t.summary}` : ''}${t.cost ? ` · $${t.cost}` : ''}`;
              return (
                <span
                  key={i}
                  title={tooltip}
                  className={`tool-badge tool-badge-${kind}`}
                  style={{ background: style.bg, color: style.fg, borderColor: style.border }}
                >
                  <span>{label}</span>
                  {t.cost && <span className="tool-badge-aux">${t.cost}</span>}
                  {!t.cost && t.summary && t.summary.length < 28 && (
                    <span className="tool-badge-aux">{t.summary}</span>
                  )}
                </span>
              );
            })}
          </div>
        )}
        <div className={`chat-bubble-agent ${isSanitized ? 'sanitized' : ''}`}>{renderMarkdown(m.text)}</div>
        {bridgeId && <BridgeChatTracker bridgeId={bridgeId} />}
        {inlineForm === 'bridge' && (
          <BridgeForm
            onSend={cmd => { setInlineForm(null); onQuickAction(cmd); }}
            onCancel={() => setInlineForm(null)}
          />
        )}
        {inlineForm === 'swap' && (
          <SwapForm
            onSend={cmd => { setInlineForm(null); onQuickAction(cmd); }}
            onCancel={() => setInlineForm(null)}
          />
        )}
        {!inlineForm && quick.length > 0 && (
          <div className="chat-quick-row">
            {quick.map((q, i) => (
              <button key={i} className="chat-quick-chip" onClick={() => handleQuickClick(q)}>
                {q.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Thinking indicator ──────────────────────────────────────────────────────
function ThinkingIndicator({ runningTool }: { runningTool: string | null }) {
  return (
    <div className="chat-msg-row chat-msg-agent">
      <div className="chat-agent-orb chat-agent-orb-pulse">
        <span className="chat-agent-orb-inner" />
      </div>
      <div className="chat-msg-stack">
        <div className="chat-agent-label">
          <span className="chat-agent-name">Aegis</span>
          <span className="chat-agent-meta">{runningTool ? 'executing tool' : 'thinking'}</span>
        </div>
        <div className="chat-thinking">
          {runningTool ? (
            <span className="chat-thinking-shimmer">{runningTool}</span>
          ) : (
            <span className="chat-thinking-dots">
              <span /><span /><span />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const { ready } = useBackendAuth();
  const toast = useToast();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastSentText, setLastSentText] = useState('');
  const [agentAddress, setAgentAddress] = useState<string | null>(null);
  const [agentAddressFull, setAgentAddressFull] = useState<string | null>(null);
  const [maxTxUsd, setMaxTxUsd] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Prevent page-level scroll on chat - only the message body should scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Initial load
  useEffect(() => {
    if (!ready) return;
    setLoadingThreads(true);
    Promise.all([
      api.get<{ threads: Thread[] }>('/chat/threads'),
      api.get<{ wallet: { agentAddress: string; maxTxSizeUsd?: number } | null }>('/agent-wallet'),
    ])
      .then(([threadData, walletData]) => {
        setThreads(threadData.threads);
        if (walletData.wallet?.agentAddress) {
          const addr = walletData.wallet.agentAddress;
          setAgentAddressFull(addr);
          setAgentAddress(addr.slice(0, 6) + '…' + addr.slice(-4));
        }
        if (typeof walletData.wallet?.maxTxSizeUsd === 'number') setMaxTxUsd(walletData.wallet.maxTxSizeUsd);
        if (threadData.threads.length > 0) setActive(threadData.threads[0].id);
      })
      .catch(() => toast.error('Could not load your agent', 'Conversations and wallet failed to load. Refresh to retry.'))
      .finally(() => setLoadingThreads(false));
  }, [ready, toast]);

  // Load messages on thread switch
  useEffect(() => {
    if (!active) { setMessages([]); return; }
    setLoadingMessages(true);
    api.get<{ messages: ApiMessage[] }>(`/chat?threadId=${active}&limit=100`)
      .then(data => setMessages(data.messages.map(msgFromApi)))
      .catch(() => { setMessages([]); toast.error('Could not load conversation', 'Check your connection and try again'); })
      .finally(() => setLoadingMessages(false));
  }, [active, toast]);

  // Auto-scroll
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  // Auto-resize textarea
  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 180) + 'px';
  }, [draft]);

  const runningTool = useMemo(() => (sending ? inferRunningTool(lastSentText) : null), [sending, lastSentText]);

  const [creatingThread, setCreatingThread] = useState(false);
  const newChat = async () => {
    if (creatingThread) return;
    setCreatingThread(true);
    try {
      const data = await api.post<{ thread: Thread }>('/chat/threads', {});
      setThreads(prev => [data.thread, ...prev]);
      setActive(data.thread.id);
      setMessages([]);
      setDraft('');
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (err) {
      toast.error('Could not start a new conversation', err instanceof Error ? err.message : 'Try again');
    } finally {
      setCreatingThread(false);
    }
  };

  const deleteThread = async (threadId: string) => {
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return;
    try {
      await api.delete(`/chat/threads/${threadId}`);
      setThreads(prev => prev.filter(t => t.id !== threadId));
      if (active === threadId) {
        const remaining = threads.filter(t => t.id !== threadId);
        setActive(remaining.length > 0 ? remaining[0].id : null);
        setMessages([]);
      }
    } catch (err) {
      toast.error('Could not delete conversation', err instanceof Error ? err.message : 'Try again');
    }
  };

  const sendText = async (text: string) => {
    if (!text.trim() || sending) return;
    const body = text.trim();
    setDraft('');
    setLastSentText(body);
    setSending(true);

    let threadId = active;
    if (!threadId) {
      try {
        const data = await api.post<{ thread: Thread }>('/chat/threads', {});
        threadId = data.thread.id;
        setThreads(prev => [data.thread, ...prev]);
        setActive(data.thread.id);
      } catch { setSending(false); return; }
    }

    setMessages(m => [...m, { role: 'you', text: body }]);

    try {
      const data = await api.post<{ message: ApiMessage; toolsUsed?: ToolTrace[] | null }>('/chat', { content: body, threadId });
      const msg = msgFromApi(data.message);
      if (msg.role === 'agent' && msg.kind === 'text' && data.toolsUsed && data.toolsUsed.length > 0) {
        msg.toolsUsed = data.toolsUsed;
      }
      setMessages(m => [...m, msg]);
      setThreads(prev => prev.map(t =>
        t.id === threadId
          ? { ...t, lastMessageAt: new Date().toISOString(), title: t.title === 'New conversation' ? body.slice(0, 45) + (body.length > 45 ? '…' : '') : t.title }
          : t
      ));
    } catch {
      setMessages(m => [...m, { role: 'agent', kind: 'text', text: 'Something went wrong. Please try again.' }]);
    } finally {
      setSending(false);
    }
  };

  const send = () => sendText(draft);
  const activeThread = threads.find(t => t.id === active);

  // Empty-state suggestions when conversation is new.
  // Curated so a first-time visitor sees the differentiator on chip click:
  // money actually moves, Guardian pre-checks, and the core Circle flows
  // (CCTP, ERC-8183, Wallets, Swap Kit FX) each get a touchpoint.
  const [emptyBridgeOpen, setEmptyBridgeOpen] = useState(false);
  const [emptySwapOpen, setEmptySwapOpen] = useState(false);

  const emptyStateActions: (QuickAction & { form?: 'bridge' | 'swap' })[] = [
    { label: 'Bridge USDC',         send: '', form: 'bridge' },
    { label: 'Swap stablecoins',    send: '', form: 'swap' },
    { label: 'Set max $20 per tx',  send: 'Set Guardian policy: max $20 per transaction.' },
    { label: 'Show my balance',     send: 'Show my balance.' },
  ];

  return (
    <div className="chat-page" style={{ height: 'calc(100vh - 60px)' }}>
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="chat-side chat-side-v2">
        <button className="btn-new-chat" onClick={newChat} disabled={creatingThread}>
          <span className="btn-new-chat-icon"><IconPlus size={11} /></span>
          <span>New conversation</span>
          <span className="kbd-hint">⌘N</span>
        </button>

        <div className="chat-side-section">
          <div className="chat-side-label">Recent</div>
          <div className="chat-side-threads">
            {loadingThreads && <div className="chat-side-empty">Loading…</div>}
            {!loadingThreads && threads.length === 0 && (
              <div className="chat-side-empty">No conversations yet</div>
            )}
            {threads.map(t => (
              <div key={t.id} className={`thread-row ${active === t.id ? 'is-active' : ''}`}>
                <button className="thread-row-btn" onClick={() => setActive(t.id)}>
                  <div className="thread-row-title">{t.title}</div>
                  <div className="thread-row-time">{formatThreadTime(t.lastMessageAt)}</div>
                </button>
                <button className="thread-row-del" onClick={() => deleteThread(t.id)} title="Delete">✕</button>
              </div>
            ))}
          </div>
        </div>

      </aside>

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <div className="chat-main">
        {/* Header */}
        <header className="chat-head-v2">
          <div className="chat-head-brand">
            <BrandMark size={22} />
            <div>
              <div className="chat-head-title">{activeThread?.title ?? 'Talk to Aegis'}</div>
              <div className="chat-head-sub">{messages.length} {messages.length === 1 ? 'message' : 'messages'}</div>
            </div>
          </div>
          <div className="chat-head-pills">
            {agentAddress && agentAddressFull && (
              <a className="head-pill" href={`${ARC_EXPLORER}/address/${agentAddressFull}`} target="_blank" rel="noopener noreferrer">
                <IconWallet size={10} /> {agentAddress}
              </a>
            )}
            <span className="head-pill head-pill-ok">
              <span className="head-pill-dot" /> connected
            </span>
          </div>
        </header>

        {/* Message stream */}
        <div className="chat-main-body chat-main-body-v2" ref={bodyRef}>
          <div className="chat-main-inner chat-main-inner-v2">
            {loadingMessages && <div className="chat-state">Loading conversation…</div>}

            {!loadingMessages && active && messages.length === 0 && !sending && (
              <div className="chat-empty-hero">
                <div className="chat-empty-eyebrow">Aegis is ready</div>
                <div className="chat-empty-title">
                  What should your agent do<span className="chat-empty-period">?</span>
                </div>
                <div className="chat-empty-sub">
                  Move USDC, run jobs, bridge across chains. All under your Guardian policy.
                  Actions over your per-tx cap need a Telegram tap.
                </div>
                <div className="chat-empty-chips">
                  {emptyStateActions.map((q, i) => (
                    <button
                      key={i}
                      className="chat-quick-chip chat-quick-chip-empty"
                      onClick={() => {
                        if (q.form === 'bridge') { setEmptyBridgeOpen(true); setEmptySwapOpen(false); }
                        else if (q.form === 'swap') { setEmptySwapOpen(true); setEmptyBridgeOpen(false); }
                        else sendText(q.send);
                      }}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
                {emptyBridgeOpen && (
                  <BridgeForm
                    onSend={cmd => { setEmptyBridgeOpen(false); sendText(cmd); }}
                    onCancel={() => setEmptyBridgeOpen(false)}
                  />
                )}
                {emptySwapOpen && (
                  <SwapForm
                    onSend={cmd => { setEmptySwapOpen(false); sendText(cmd); }}
                    onCancel={() => setEmptySwapOpen(false)}
                  />
                )}
              </div>
            )}

            {!loadingMessages && !active && (
              <div className="chat-state">Start a new conversation</div>
            )}

            {messages.map((m, i) => (
              <ChatMessage
                key={i}
                m={m}
                isLast={i === messages.length - 1 && !sending}
                onQuickAction={sendText}
              />
            ))}

            {sending && <ThinkingIndicator runningTool={runningTool} />}
          </div>
        </div>

        {/* Composer */}
        <div className="chat-composer chat-composer-v2">
          <div className="chat-composer-inner chat-composer-inner-v2">
            <textarea
              ref={inputRef}
              className="chat-input chat-input-v2"
              rows={1}
              placeholder='Ask Aegis to do something. For example: "bridge 10 USDC to Base"'
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                if (e.key === 'n' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); newChat(); }
              }}
              disabled={sending}
            />
            <button className={`chat-send chat-send-v2 ${draft.trim() && !sending ? 'is-ready' : ''}`} onClick={send} disabled={sending || !draft.trim()}>
              <IconSend size={14} />
            </button>
          </div>
          <div className="chat-composer-foot">
            <span><kbd>↵</kbd> send · <kbd>⇧↵</kbd> new line</span>
            <span className="chat-composer-foot-warn">Above-threshold actions require Telegram approval</span>
          </div>
        </div>
      </div>
    </div>
  );
}
