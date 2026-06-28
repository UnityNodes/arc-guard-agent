'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useBackendAuth } from '@/hooks/useBackendAuth';
import { useToast } from '@/components/ui/toast';
import {
  IconArrowDown, IconArrowUp, IconExternal, IconShield, IconSwap,
  IconDownload, IconSearch, IconCheck, IconClose,
} from '@/components/Icons';
import { TokenMark } from '@/components/Atoms';
import { Term } from '@/components/Term';

const ARC_EXPLORER = 'https://testnet.arcscan.app';

interface TransferEvent {
  token: 'USDC' | 'EURC';
  blockNumber: string;
  logIndex: number;
  txHash: string;
  from: string;
  to: string;
  amountRaw: string;
  amountFormatted: string;
  fromForwarder: 'memo' | 'multicall3from' | null;
  toForwarder: 'memo' | 'multicall3from' | null;
}

interface MemoEvent {
  blockNumber: string;
  logIndex: number;
  txHash: string;
  sender: string;
  target: string;
  memoId: string;
  memoHex: string;
  memoText: string | null;
}

interface ActivityItem {
  kind: 'TRANSFER' | 'MEMO';
  blockNumber: string;
  logIndex: number;
  txHash: string;
  data: TransferEvent | MemoEvent;
}

interface ActivityResponse {
  address: string;
  range: { fromBlock: string; toBlock: string };
  items: ActivityItem[];
  blocklist: {
    asOfBlock: string;
    isCallerBlocked: boolean;
    totalBlocked: number;
  };
}

interface BlocklistEvent {
  blockNumber: string;
  logIndex: number;
  txHash: string;
  account: string;
  action: 'BLOCKED' | 'UNBLOCKED';
}

const shortAddr = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '-');
const shortHash = (h: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : '-');

function isTransfer(item: ActivityItem): item is ActivityItem & { data: TransferEvent } {
  return item.kind === 'TRANSFER';
}

function isMemo(item: ActivityItem): item is ActivityItem & { data: MemoEvent } {
  return item.kind === 'MEMO';
}

type DirFilter = 'all' | 'in' | 'out';
type TabName = 'feed' | 'blocklist';

export default function ActivityPage() {
  const { ready } = useBackendAuth();
  const toast = useToast();

  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [blocklistEvents, setBlocklistEvents] = useState<BlocklistEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<TabName>('feed');
  const [dirFilter, setDirFilter] = useState<DirFilter>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const a = await api.get<ActivityResponse>('/events/activity');
      setActivity(a);
      const b = await api.get<{ events: BlocklistEvent[] }>('/events/blocklist?history=1').catch(() => ({ events: [] }));
      setBlocklistEvents(b.events ?? []);
    } catch (err) {
      toast.error('Failed to load activity', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const memoByTx = useMemo(() => {
    const map = new Map<string, MemoEvent>();
    for (const it of activity?.items ?? []) {
      if (isMemo(it)) map.set(it.txHash.toLowerCase(), it.data);
    }
    return map;
  }, [activity]);

  const allTransfers = useMemo(
    () => (activity?.items ?? []).filter(isTransfer),
    [activity],
  );

  const counts = useMemo(() => {
    const me = activity?.address.toLowerCase() ?? '';
    let inboundN = 0, outboundN = 0;
    let inboundUsd = 0, outboundUsd = 0;
    for (const it of allTransfers) {
      const t = it.data;
      const amount = parseFloat(t.amountFormatted) || 0;
      if (t.from.toLowerCase() === me) {
        outboundN += 1;
        outboundUsd += amount;
      } else {
        inboundN += 1;
        inboundUsd += amount;
      }
    }
    return { inboundN, outboundN, inboundUsd, outboundUsd };
  }, [allTransfers, activity]);

  const filteredTransfers = useMemo(() => {
    const me = activity?.address.toLowerCase() ?? '';
    const q = query.trim().toLowerCase();
    return allTransfers.filter((it) => {
      const t = it.data;
      const direction = t.from.toLowerCase() === me ? 'out' : 'in';
      if (dirFilter !== 'all' && dirFilter !== direction) return false;
      if (q) {
        const matches =
          t.txHash.toLowerCase().includes(q) ||
          t.from.toLowerCase().includes(q) ||
          t.to.toLowerCase().includes(q) ||
          (memoByTx.get(it.txHash.toLowerCase())?.memoText ?? '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [allTransfers, activity, dirFilter, query, memoByTx]);

  const newestTx = filteredTransfers[0]?.txHash;

  return (
    <div className="arc-page">
      {/* KPI strip */}
      <div className="arc-kpi-row">
        <div className="arc-kpi">
          <span className="arc-kpi-label">Address</span>
          <span className="arc-kpi-value font-mono" style={{ fontSize: 13 }}>
            {activity ? shortAddr(activity.address) : '-'}
          </span>
        </div>
        <div className="arc-kpi">
          <span className="arc-kpi-label">Block range</span>
          <span className="arc-kpi-value font-mono" style={{ fontSize: 13 }}>
            {activity ? `${activity.range.fromBlock} → ${activity.range.toBlock}` : '-'}
          </span>
        </div>
        <div className="arc-kpi">
          <span className="arc-kpi-label">Inbound</span>
          <span className="arc-kpi-value" style={{ color: 'rgb(110,231,183)' }}>
            {counts.inboundN}
          </span>
        </div>
        <div className="arc-kpi">
          <span className="arc-kpi-label">Outbound</span>
          <span className="arc-kpi-value">{counts.outboundN}</span>
        </div>
        <div className="arc-kpi">
          <span className="arc-kpi-label">USDC blocklist</span>
          <span className="arc-kpi-value">
            {activity?.blocklist.isCallerBlocked ? (
              <span className="ga-pill ga-pill-err"><IconClose size={10}/> Blocked</span>
            ) : (
              <span className="ga-pill ga-pill-ok"><IconCheck size={10}/> Clear</span>
            )}
          </span>
        </div>
      </div>

      {/* Main card */}
      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconDownload size={13}/> On-chain Activity</span>
          <button className="arc-link-btn" onClick={load} disabled={loading}>
            <IconSwap size={11}/> {loading ? 'Indexing…' : 'Refresh'}
          </button>
        </div>

        {/* Tabs */}
        <div className="arc-tab-bar" style={{ padding: '0 18px', borderBottom: '1px solid var(--arc-border)' }}>
          <button
            className={`arc-tab${tab === 'feed' ? ' arc-tab-active' : ''}`}
            onClick={() => setTab('feed')}
          >
            <IconArrowDown size={11}/> Transfers
            <span style={{ marginLeft: 5, opacity: 0.5, fontSize: 11 }}>{allTransfers.length}</span>
          </button>
          <button
            className={`arc-tab${tab === 'blocklist' ? ' arc-tab-active' : ''}`}
            onClick={() => setTab('blocklist')}
          >
            <IconShield size={11}/> Blocklist history
            <span style={{ marginLeft: 5, opacity: 0.5, fontSize: 11 }}>{blocklistEvents.length}</span>
          </button>
        </div>

        {/* Filters (feed tab only) */}
        {tab === 'feed' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--arc-border)' }}>
            <div className="arc-tab-bar" style={{ padding: 0, border: 'none' }}>
              {(['all', 'in', 'out'] as DirFilter[]).map(d => (
                <button
                  key={d}
                  className={`arc-tab${dirFilter === d ? ' arc-tab-active' : ''}`}
                  onClick={() => setDirFilter(d)}
                >
                  {d === 'all' ? 'All' : d === 'in' ? <><IconArrowDown size={10}/> Inbound</> : <><IconArrowUp size={10}/> Outbound</>}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, background: 'var(--arc-surface)', border: '1px solid var(--arc-border)', borderRadius: 6, padding: '4px 10px' }}>
              <IconSearch size={12} style={{ opacity: 0.4 }}/>
              <input
                style={{ background: 'none', border: 'none', outline: 'none', flex: 1, fontSize: 12, color: 'var(--arc-text)' }}
                placeholder="filter by address, tx hash, memo…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              {query && (
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, display: 'flex', alignItems: 'center' }} onClick={() => setQuery('')}>
                  <IconClose size={11}/>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Body */}
        {tab === 'feed' ? (
          <>
            {loading && allTransfers.length === 0 && (
              <div className="arc-empty">Pulling logs from Arc Testnet…</div>
            )}
            {!loading && filteredTransfers.length === 0 && (
              allTransfers.length === 0 ? (
                <div className="arc-empty" style={{ flexDirection: 'column', gap: 8, padding: '32px 18px' }}>
                  <IconDownload size={24} style={{ opacity: 0.3 }}/>
                  <div style={{ fontWeight: 500 }}>No on-chain activity yet</div>
                  <div style={{ opacity: 0.5, fontSize: 12, maxWidth: 480, textAlign: 'center', lineHeight: 1.6 }}>
                    This page is a live <Term>eth_getLogs</Term> indexer. Every Transfer and Memo event touching your agent address shows up here as it lands on <Term>Arc</Term>. Try dropping testnet USDC from <em>/settings &rarr; Developer &rarr; Drop tokens</em>, or send something through Aegis in <em>/chat</em>.
                  </div>
                </div>
              ) : (
                <div className="arc-empty">No events match the current filter.</div>
              )
            )}
            {filteredTransfers.length > 0 && (
              <div className="arc-table-wrap">
                <table className="arc-table">
                  <thead>
                    <tr>
                      <th>Dir</th>
                      <th>Amount</th>
                      <th>Counterparty</th>
                      <th>Block</th>
                      <th>Tx</th>
                      <th>Memo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransfers.map((it) => (
                      <TransferRow
                        key={`${it.blockNumber}-${it.logIndex}`}
                        transfer={it.data as TransferEvent}
                        myAddress={activity?.address ?? ''}
                        memo={memoByTx.get(it.txHash.toLowerCase())}
                        isNewest={it.txHash === newestTx}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <>
            {loading && blocklistEvents.length === 0 && (
              <div className="arc-empty">Pulling Blocklisted / UnBlocklisted history…</div>
            )}
            {!loading && blocklistEvents.length === 0 && (
              <div className="arc-empty" style={{ flexDirection: 'column', gap: 8, padding: '32px 18px' }}>
                <IconShield size={24} style={{ opacity: 0.3 }}/>
                <div style={{ fontWeight: 500 }}>No blocklist events in this window</div>
                <div style={{ opacity: 0.5, fontSize: 12, maxWidth: 480, textAlign: 'center', lineHeight: 1.6 }}>
                  Circle maintains an on-chain registry of addresses blocked from USDC. Activity here shows real Blocklisted / UnBlocklisted events. A quiet window means nothing changed recently.
                </div>
              </div>
            )}
            {blocklistEvents.length > 0 && (
              <div className="arc-table-wrap">
                <table className="arc-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Account</th>
                      <th>Block</th>
                      <th>Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blocklistEvents.map((e) => (
                      <BlocklistRow
                        key={`${e.blockNumber}-${e.logIndex}`}
                        event={e}
                        myAddress={activity?.address ?? ''}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Transfer row ────────────────────────────────────────────────────────────
function TransferRow({
  transfer, myAddress, memo, isNewest,
}: {
  transfer: TransferEvent;
  myAddress: string;
  memo: MemoEvent | undefined;
  isNewest: boolean;
}) {
  const t = transfer;
  const me = myAddress.toLowerCase();
  const direction: 'in' | 'out' = t.from.toLowerCase() === me ? 'out' : 'in';
  const counterparty = direction === 'in' ? t.from : t.to;
  const forwarder = direction === 'in' ? t.fromForwarder : t.toForwarder;
  const memoBody = memo?.memoText ?? memo?.memoHex ?? null;

  return (
    <tr data-newest={isNewest || undefined}>
      <td>
        <span className={`ga-pill ${direction === 'in' ? 'ga-pill-ok' : 'ga-pill-warn'}`}>
          {direction === 'in' ? <IconArrowDown size={10}/> : <IconArrowUp size={10}/>}
          {direction}
        </span>
      </td>
      <td>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className="ga-mono-num">
            {direction === 'in' ? '+' : '−'}{t.amountFormatted}
          </span>
          <TokenMark symbol={t.token} size={12}/>
          <span style={{ opacity: 0.6, fontSize: 11 }}>{t.token}</span>
        </span>
      </td>
      <td>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <a
            style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--arc-accent)', textDecoration: 'none' }}
            href={`${ARC_EXPLORER}/address/${counterparty}`}
            target="_blank" rel="noopener noreferrer"
          >
            {shortAddr(counterparty)}
          </a>
          {forwarder && (
            <span style={{ fontSize: 10, opacity: 0.5 }}>via {forwarder}</span>
          )}
        </span>
      </td>
      <td><span className="font-mono" style={{ fontSize: 11, opacity: 0.6 }}>#{t.blockNumber}</span></td>
      <td>
        <a
          style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--arc-accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}
          href={`${ARC_EXPLORER}/tx/${t.txHash}`}
          target="_blank" rel="noopener noreferrer"
        >
          {shortHash(t.txHash)}<IconExternal size={10}/>
        </a>
      </td>
      <td>
        {memoBody && (
          <span style={{ fontSize: 11, opacity: 0.7, fontStyle: 'italic' }}>"{memoBody}"</span>
        )}
      </td>
    </tr>
  );
}

// ─── Blocklist row ───────────────────────────────────────────────────────────
function BlocklistRow({ event: e, myAddress }: { event: BlocklistEvent; myAddress: string }) {
  const isMe = myAddress && e.account.toLowerCase() === myAddress.toLowerCase();
  return (
    <tr>
      <td>
        <span className={`ga-pill ${e.action === 'BLOCKED' ? 'ga-pill-err' : 'ga-pill-ok'}`}>
          <IconShield size={10}/> {e.action}
        </span>
        {isMe && <span className="ga-pill ga-pill-warn" style={{ marginLeft: 6 }}>you</span>}
      </td>
      <td>
        <a
          style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--arc-accent)', textDecoration: 'none' }}
          href={`${ARC_EXPLORER}/address/${e.account}`}
          target="_blank" rel="noopener noreferrer"
        >
          {e.account}
        </a>
      </td>
      <td><span className="font-mono" style={{ fontSize: 11, opacity: 0.6 }}>#{e.blockNumber}</span></td>
      <td>
        <a
          style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--arc-accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}
          href={`${ARC_EXPLORER}/tx/${e.txHash}`}
          target="_blank" rel="noopener noreferrer"
        >
          {shortHash(e.txHash)}<IconExternal size={10}/>
        </a>
      </td>
    </tr>
  );
}
