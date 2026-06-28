'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useBackendAuth } from '@/hooks/useBackendAuth';
import {
  IconShield, IconSearch, IconCheck, IconClose, IconPause,
  IconDownload, IconChevronRight, IconChevronDown,
} from '@/components/Icons';
import { Term } from '@/components/Term';

interface LogEntry {
  id: string;
  action: string;
  detail: unknown;
  actor: string;
  createdAt: string;
}

type Verdict = 'allowed' | 'blocked' | 'pending' | 'event';
type Family =
  | 'withdraw' | 'swap' | 'bridge' | 'transfer' | 'gateway'
  | 'approval' | 'alert' | 'autopilot' | 'policy' | 'rule' | 'job'
  | 'identity' | 'wallet' | 'system';

const ACTION_LABELS: Record<string, string> = {
  WITHDRAW: 'Withdraw',
  WITHDRAW_SCREENED_BLOCK: 'Withdraw blocked',
  WITHDRAW_APPROVED: 'Withdraw approved',
  WITHDRAW_DENIED: 'Withdraw denied',
  WITHDRAW_NEEDS_APPROVAL: 'Approval required',
  SWAP: 'Swap',
  SWAP_APPROVED: 'Swap approved',
  SWAP_DENIED: 'Swap denied',
  BRIDGE: 'Bridge',
  BRIDGE_APPROVED: 'Bridge approved',
  TRANSFER: 'Transfer',
  TRANSFER_APPROVED: 'Transfer approved',
  TRANSFER_DENIED: 'Transfer denied',
  NANOPAY: 'Nanopay',
  GATEWAY_SPEND: 'Gateway spend',
  AUTOPILOT_RUN: 'Autopilot run',
  AUTOPILOT_SWEEP_EARN: 'Autopilot sweep',
  POLICY_UPDATED: 'Policy updated',
  ALERT_TRIGGERED: 'Alert triggered',
  APPROVAL_SENT: 'Approval sent',
  APPROVAL_REQUESTED: 'Approval requested',
  APPROVAL_GRANTED: 'Approved',
  APPROVAL_REJECTED: 'Rejected',
  ERC8004_REGISTERED: 'Identity registered',
  WALLET_CREATED: 'Wallet created',
  RULE_BRIDGE_EXECUTED: 'Auto-bridge fired',
  RULE_BRIDGE_BLOCKED: 'Auto-bridge blocked',
  RULE_BRIDGE_FAILED: 'Auto-bridge failed',
  AUTONOMOUS_RULE_CREATED: 'Autonomous rule armed',
  JOB_SUBMITTED: 'Job submitted',
  JOB_COMPLETED: 'Job completed',
  JOB_FUND_EXECUTED: 'Job funded',
  JOB_CREATED: 'Job created',
  JOB_FAILED: 'Job failed',
};

function formatAction(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  return action.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function verdictOf(action: string): Verdict {
  if (/_APPROVED$|_GRANTED$|_EXECUTED$|_COMPLETED$|_SETTLED$|_FUNDED$/.test(action)) return 'allowed';
  if (/_DENIED$|_REJECTED$|_BLOCK$|_FAILED$|_CANCELLED$/.test(action)) return 'blocked';
  if (/_NEEDS_APPROVAL$|_REQUESTED$|_SENT$|_SUBMITTED$|_PENDING$/.test(action)) return 'pending';
  return 'event';
}

function familyOf(action: string): Family {
  if (action.startsWith('RULE_BRIDGE')) return 'bridge';
  if (action.startsWith('RULE')) return 'rule';
  if (action.startsWith('JOB')) return 'job';
  if (action.startsWith('AUTONOMOUS')) return 'autopilot';
  if (action.startsWith('WITHDRAW')) return 'withdraw';
  if (action.startsWith('SWAP')) return 'swap';
  if (action.startsWith('BRIDGE')) return 'bridge';
  if (action.startsWith('TRANSFER')) return 'transfer';
  if (action.startsWith('GATEWAY') || action === 'NANOPAY') return 'gateway';
  if (action.startsWith('APPROVAL')) return 'approval';
  if (action.startsWith('ALERT')) return 'alert';
  if (action.startsWith('AUTOPILOT')) return 'autopilot';
  if (action.startsWith('POLICY')) return 'policy';
  if (action.startsWith('ERC8004') || action.startsWith('IDENTITY')) return 'identity';
  if (action.startsWith('WALLET')) return 'wallet';
  return 'system';
}

const FAMILY_LABEL: Record<Family, string> = {
  withdraw: 'withdraw', swap: 'swap', bridge: 'bridge', transfer: 'transfer',
  gateway: 'gateway', approval: 'approval', alert: 'alert', autopilot: 'autopilot',
  policy: 'policy', rule: 'rule', job: 'job',
  identity: 'identity', wallet: 'wallet', system: 'system',
};

function detailText(detail: unknown): string {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  if (typeof detail === 'object') {
    const d = detail as Record<string, unknown>;
    if (d.amountUsd) return `$${Number(d.amountUsd).toFixed(2)}`;
    if (d.amount && d.token) {
      const amt = String(d.amount);
      const tok = String(d.token);
      // Avoid "2.00 USDC USDC" if amount already includes the token symbol
      return amt.toUpperCase().includes(tok.toUpperCase()) ? amt : `${amt} ${tok}`;
    }
    if (d.message) return String(d.message);
    if (d.reason) return String(d.reason);
  }
  return '';
}

const ACTOR_META: Record<string, { label: string; color: string; bg: string }> = {
  agent:  { label: 'Aegis',  color: '#C4622A', bg: 'rgba(196,98,42,0.10)' },
  worker: { label: 'Worker', color: '#7c3aed', bg: 'rgba(124,58,237,0.10)' },
  system: { label: 'System', color: '#6B4635', bg: 'rgba(107,70,53,0.10)' },
  user:   { label: 'You',    color: '#1A7F4B', bg: 'rgba(26,127,75,0.10)' },
};

function ActorBadge({ actor }: { actor: string }) {
  const key = actor?.toLowerCase();
  const isUserId = /^[a-z0-9]{20,}$/i.test(actor) && !actor.includes('.') && !actor.includes('@');
  const meta = ACTOR_META[key] ?? ACTOR_META[isUserId ? 'user' : 'system'];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: '999px',
      fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600,
      color: meta.color, background: meta.bg,
      letterSpacing: '0.02em', whiteSpace: 'nowrap',
    }}>
      {meta.label}
    </span>
  );
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(today.getTime() - 86_400_000);
  const ymd = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (ymd(d) === ymd(today)) return 'Today';
  if (ymd(d) === ymd(yest)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function VerdictMark({ v }: { v: Verdict }) {
  if (v === 'allowed') return <span className="ga-audit-verdict" data-v="allowed"><IconCheck size={11}/></span>;
  if (v === 'blocked') return <span className="ga-audit-verdict" data-v="blocked"><IconClose size={11}/></span>;
  if (v === 'pending') return <span className="ga-audit-verdict" data-v="pending"><IconPause size={11}/></span>;
  return <span className="ga-audit-verdict" data-v="event"><span className="ga-audit-verdict-dot"/></span>;
}

export default function AuditPage() {
  const { ready } = useBackendAuth();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(50);
  const [verdictFilter, setVerdictFilter] = useState<'all' | Verdict>('all');
  const [familyFilter, setFamilyFilter] = useState<'all' | Family>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const d = await api.get<{ logs: LogEntry[] }>(`/agent/audit?limit=${limit}`);
      setLogs(d.logs ?? []);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [ready, limit]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { total: logs.length, allowed: 0, blocked: 0, pending: 0 };
    for (const l of logs) {
      const v = verdictOf(l.action);
      if (v === 'allowed') c.allowed += 1;
      else if (v === 'blocked') c.blocked += 1;
      else if (v === 'pending') c.pending += 1;
    }
    return c;
  }, [logs]);

  const familyCounts = useMemo(() => {
    const c: Record<Family, number> = { withdraw:0, swap:0, bridge:0, transfer:0, gateway:0, approval:0, alert:0, autopilot:0, policy:0, rule:0, job:0, identity:0, wallet:0, system:0 };
    for (const l of logs) c[familyOf(l.action)] += 1;
    return c;
  }, [logs]);

  const topFamilies = useMemo(() => {
    return (Object.entries(familyCounts) as [Family, number][])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [familyCounts]);

  const blockRate = counts.total > 0 ? Math.round((counts.blocked / counts.total) * 100) : 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter(l => {
      if (verdictFilter !== 'all' && verdictOf(l.action) !== verdictFilter) return false;
      if (familyFilter !== 'all' && familyOf(l.action) !== familyFilter) return false;
      if (q) {
        const hay = `${l.action} ${l.actor} ${typeof l.detail === 'string' ? l.detail : JSON.stringify(l.detail ?? '')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, verdictFilter, familyFilter, search]);

  const groupedByDay = useMemo(() => {
    const groups: { day: string; items: LogEntry[] }[] = [];
    for (const l of filtered) {
      const day = dayLabel(l.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(l);
      else groups.push({ day, items: [l] });
    }
    return groups;
  }, [filtered]);

  function exportCsv() {
    const rows = [
      ['time', 'action', 'verdict', 'family', 'actor', 'detail'].join(','),
      ...filtered.map(l => [
        new Date(l.createdAt).toISOString(),
        l.action,
        verdictOf(l.action),
        familyOf(l.action),
        l.actor,
        JSON.stringify(l.detail ?? '').replace(/,/g, ';'),
      ].join(',')),
    ].join('\n');
    const blob = new Blob([rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `guardian-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggle(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="arc-page">

      {/* KPI strip - verdict filter doubles as stat tiles */}
      <div className="arc-kpi-row">
        <div
          className={`arc-kpi${verdictFilter === 'all' ? ' arc-kpi-active' : ''}`}
          onClick={() => setVerdictFilter('all')}
          style={{ cursor: 'pointer' }}
        >
          <span className="arc-kpi-label">All events</span>
          <span className="arc-kpi-value">{counts.total}</span>
        </div>
        <div
          className={`arc-kpi${verdictFilter === 'allowed' ? ' arc-kpi-active' : ''}`}
          onClick={() => setVerdictFilter('allowed')}
          style={{ cursor: 'pointer' }}
          data-v="allowed"
        >
          <span className="arc-kpi-label"><IconCheck size={10}/> Allowed</span>
          <span className="arc-kpi-value">{counts.allowed}</span>
        </div>
        <div
          className={`arc-kpi${verdictFilter === 'blocked' ? ' arc-kpi-active' : ''}`}
          onClick={() => setVerdictFilter('blocked')}
          style={{ cursor: 'pointer' }}
          data-v="blocked"
        >
          <span className="arc-kpi-label"><IconClose size={10}/> Blocked</span>
          <span className="arc-kpi-value">{counts.blocked}</span>
        </div>
        <div
          className={`arc-kpi${verdictFilter === 'pending' ? ' arc-kpi-active' : ''}`}
          onClick={() => setVerdictFilter('pending')}
          style={{ cursor: 'pointer' }}
          data-v="pending"
        >
          <span className="arc-kpi-label"><IconPause size={10}/> Pending</span>
          <span className="arc-kpi-value">{counts.pending}</span>
        </div>
        <div className="arc-kpi">
          <span className="arc-kpi-label">Block rate</span>
          <span className="arc-kpi-value">{blockRate}%</span>
        </div>
      </div>

      {/* Search + family filter + export */}
      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconShield size={13}/> Audit Log</span>
          <button className="arc-link-btn" onClick={exportCsv} disabled={filtered.length === 0}>
            <IconDownload size={11}/> Export CSV
          </button>
        </div>
        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--arc-border)' }}>
          <div className="ga-audit-search" style={{ marginBottom: 10 }}>
            <IconSearch size={13}/>
            <input
              className="ga-audit-search-input"
              placeholder="Search action, actor, detail..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="ga-audit-search-clear" onClick={() => setSearch('')}><IconClose size={11}/></button>
            )}
          </div>
          <div className="arc-tab-bar" style={{ flexWrap: 'wrap', gap: 4 }}>
            <button
              className={`arc-tab${familyFilter === 'all' ? ' arc-tab-active' : ''}`}
              onClick={() => setFamilyFilter('all')}
            >
              all <span style={{ opacity: 0.5, fontSize: 10 }}>{counts.total}</span>
            </button>
            {topFamilies.map(([f, n]) => (
              <button
                key={f}
                className={`arc-tab${familyFilter === f ? ' arc-tab-active' : ''}`}
                data-family={f}
                onClick={() => setFamilyFilter(f)}
              >
                {FAMILY_LABEL[f]} <span style={{ opacity: 0.5, fontSize: 10 }}>{n}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Timeline */}
        {loading && logs.length === 0 && (
          <div className="arc-empty">Reading the forensic log...</div>
        )}
        {!loading && filtered.length === 0 && (
          logs.length === 0 ? (
            <div className="ga-empty ga-empty-instructional">
              <div className="ga-empty-icon"><IconSearch size={28}/></div>
              <div className="ga-empty-title">Nothing to audit yet</div>
              <div className="ga-empty-body">
                Every decision <Term>Guardian</Term> makes lands here. Allowed,
                blocked, or pending approval, with the verdict, the rule that fired,
                and the action that was attempted. It is the forensic trail of what{' '}
                <Term>Aegis</Term> tried to do and what your policy let through.
                <br/><br/>
                Trigger a first action by asking Aegis to do something in <em>/chat</em>.
              </div>
            </div>
          ) : (
            <div className="arc-empty">No events match the current filters.</div>
          )
        )}

        {filtered.length > 0 && (
          <div className="arc-table-wrap">
            <table className="arc-table">
              <colgroup>
                <col style={{ width: 72 }}/>
                <col style={{ width: 24 }}/>
                <col/>
                <col style={{ width: 80 }}/>
                <col style={{ width: 120 }}/>
                <col style={{ width: 80 }}/>
                <col style={{ width: 24 }}/>
              </colgroup>
              <thead>
                <tr>
                  <th>Time</th>
                  <th></th>
                  <th>Action</th>
                  <th>Category</th>
                  <th>Detail</th>
                  <th>Actor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {groupedByDay.map((g, gi) => (
                  <>
                    <tr key={`day-${g.day}-${gi}`} className="ga-audit-day-row">
                      <td colSpan={7} style={{ padding: '6px 12px', opacity: 0.45, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid var(--arc-border)' }}>
                        {g.day} &mdash; {g.items.length} event{g.items.length === 1 ? '' : 's'}
                      </td>
                    </tr>
                    {g.items.map(l => {
                      const v = verdictOf(l.action);
                      const f = familyOf(l.action);
                      const dt = detailText(l.detail);
                      const isOpen = !!expanded[l.id];
                      const hasRich = !!(l.detail && typeof l.detail === 'object' && Object.keys(l.detail as object).length > 0);
                      return (
                        <>
                          <tr
                            key={l.id}
                            className={`ga-audit-tr${isOpen ? ' is-open' : ''}`}
                            data-verdict={v}
                            onClick={() => hasRich && toggle(l.id)}
                            style={{ cursor: hasRich ? 'pointer' : 'default' }}
                          >
                            <td className="ga-audit-time">{timeOnly(l.createdAt)}</td>
                            <td><VerdictMark v={v}/></td>
                            <td className="ga-audit-action">{formatAction(l.action)}</td>
                            <td><span className="ga-audit-family" data-family={f}>{FAMILY_LABEL[f]}</span></td>
                            <td className="ga-audit-detail">{dt}</td>
                            <td className="ga-audit-actor"><ActorBadge actor={l.actor}/></td>
                            <td style={{ textAlign: 'center', opacity: hasRich ? 1 : 0 }}>
                              {isOpen ? <IconChevronDown size={12}/> : <IconChevronRight size={12}/>}
                            </td>
                          </tr>
                          {isOpen && hasRich && (
                            <tr key={`${l.id}-detail`}>
                              <td colSpan={7} style={{ padding: 0 }}>
                                <pre className="ga-audit-json">{JSON.stringify(l.detail, null, 2)}</pre>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && logs.length >= limit && (
          <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 12, borderTop: '1px solid var(--arc-border)' }}>
            <button className="arc-btn arc-btn-secondary" onClick={() => setLimit(l => l + 50)}>Load more</button>
            <span style={{ fontSize: 11, opacity: 0.45 }}>showing {filtered.length} of {logs.length} loaded</span>
          </div>
        )}
      </div>
    </div>
  );
}
