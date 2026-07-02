'use client';
import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Stats {
  users: number;
  agentWallets: number;
  transactionsSettled: number;
  transactionVolumeUsd: number;
  bridgesSettled: number;
  bridgeVolumeUsd: number;
  jobsCompleted: number;
  nanopaymentInferences: number;
  intelligence: { swapsExecuted: number; popularPairs: Array<{ pair: string; count: number }> };
  monetization: { model: string; feeBps: number; estimatedFeesUsd: number; enabled: boolean };
  chain: string;
  updatedAt: string;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}
function usd(n: number): string {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const USE_CASES = [
  { label: 'Agentic economy', on: true },
  { label: 'Stablecoin FX', on: true },
  { label: 'P2P payments', on: true },
  { label: 'Treasury management', on: true },
];

export default function StatsPage() {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const load = () => fetch(`${API_URL}/api/public/stats`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setS)
      .catch(() => setErr(true));
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, []);

  const cards = s ? [
    { label: 'Users', value: fmt(s.users) },
    { label: 'Agent wallets', value: fmt(s.agentWallets) },
    { label: 'Transactions settled', value: fmt(s.transactionsSettled) },
    { label: 'Transaction volume', value: usd(s.transactionVolumeUsd) },
    { label: 'CCTP bridges settled', value: fmt(s.bridgesSettled) },
    { label: 'Bridge volume', value: usd(s.bridgeVolumeUsd) },
    { label: 'Escrow jobs completed', value: fmt(s.jobsCompleted) },
    { label: 'Nanopayment inferences', value: fmt(s.nanopaymentInferences) },
  ] : [];

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-0, #0a0a0d)', color: 'var(--ink-1, #f5f3ee)', padding: '64px 24px', fontFamily: 'var(--font-sans, Inter, system-ui)' }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--accent, #d98b4e)', fontWeight: 700, marginBottom: 12 }}>
          GuardAgent AI · Live on {s?.chain ?? 'Arc Testnet'}
        </div>
        <h1 style={{ fontSize: 34, fontWeight: 700, margin: '0 0 8px', lineHeight: 1.15 }}>
          Autonomous stablecoin commerce, in numbers
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-3, #a8a39a)', margin: '0 0 36px', maxWidth: 620, lineHeight: 1.6 }}>
          Every figure below is real on-chain and platform activity on Arc, settled in USDC through the Circle stack.
          Refreshes every 30 seconds.
        </p>

        {err && !s && (
          <div style={{ padding: 20, border: '1px solid var(--line-1, #2a2a30)', borderRadius: 12, color: 'var(--ink-3, #a8a39a)' }}>
            Live stats are momentarily unavailable. Retrying…
          </div>
        )}

        {s && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 32 }}>
              {cards.map(c => (
                <div key={c.label} style={{ padding: '20px 22px', background: 'var(--bg-2, #15151a)', border: '1px solid var(--line-1, #2a2a30)', borderRadius: 14 }}>
                  <div style={{ fontFamily: 'var(--font-mono, JetBrains Mono, monospace)', fontSize: 30, fontWeight: 700, marginBottom: 6 }}>{c.value}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-3, #a8a39a)' }}>{c.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 28 }}>
              <div style={{ padding: '20px 22px', background: 'color-mix(in oklab, var(--accent, #d98b4e) 8%, var(--bg-2, #15151a))', border: '1px solid color-mix(in oklab, var(--accent, #d98b4e) 30%, var(--line-1, #2a2a30))', borderRadius: 14 }}>
                <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent, #d98b4e)', fontWeight: 700, marginBottom: 10 }}>Revenue path</div>
                <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>{usd(s.monetization.estimatedFeesUsd)}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3, #a8a39a)', lineHeight: 1.5 }}>
                  estimated fees earned at {s.monetization.feeBps} bps on every bridge and swap. {s.monetization.model}.
                </div>
              </div>
              <div style={{ padding: '20px 22px', background: 'var(--bg-2, #15151a)', border: '1px solid var(--line-1, #2a2a30)', borderRadius: 14 }}>
                <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3, #a8a39a)', fontWeight: 700, marginBottom: 12 }}>Priority use cases covered</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {USE_CASES.map(u => (
                    <span key={u.label} style={{ fontSize: 12.5, padding: '5px 11px', borderRadius: 999, background: 'color-mix(in oklab, var(--ok, #1a7f4b) 14%, transparent)', color: 'var(--ok, #45c486)', border: '1px solid color-mix(in oklab, var(--ok, #1a7f4b) 30%, transparent)' }}>
                      ✓ {u.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {s.intelligence && s.intelligence.popularPairs.length > 0 && (
              <div style={{ padding: '20px 22px', background: 'var(--bg-2, #15151a)', border: '1px solid var(--line-1, #2a2a30)', borderRadius: 14, marginBottom: 28 }}>
                <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3, #a8a39a)', fontWeight: 700, marginBottom: 12 }}>
                  Agent routing · {fmt(s.intelligence.swapsExecuted)} swaps
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {s.intelligence.popularPairs.map(p => (
                    <span key={p.pair} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, background: 'var(--bg-3, #1e1e24)', color: 'var(--ink-2, #d8d3ca)', fontFamily: 'var(--font-mono, monospace)' }}>
                      {p.pair} · {p.count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--ink-4, #6f6a62)', fontFamily: 'var(--font-mono, monospace)' }}>
              Updated {new Date(s.updatedAt).toLocaleString()} · guardagent.org
            </div>
          </>
        )}
      </div>
    </main>
  );
}
