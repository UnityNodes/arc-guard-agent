'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useBackendAuth } from '@/hooks/useBackendAuth';
import { Skeleton, ErrorState } from '@/components/Atoms';
import { IconShield, IconZap, IconSettings } from '@/components/Icons';

interface AegisStatus {
  cliInstalled: boolean;
  cliVersion: string | null;
  termsAccepted: boolean;
  loggedIn: boolean;
  email: string | null;
  sessionExpiresAt: string | null;
  defaultChain: string;
  maxPerCallUsdc: string;
  message: string;
}

interface AegisWalletInfo {
  chain: string;
  address: string;
  balanceUsdc: string;
  gatewayBalanceUsdc: string;
}

interface MarketService {
  name: string;
  url: string;
  price: string;
  chains: string[];
  description?: string;
}

const KEYWORDS = ['crypto', 'polymarket', 'weather', 'twitter', 'papers', 'news', 'sports', 'youtube'];

export default function AegisPage() {
  const { ready } = useBackendAuth();
  const [status, setStatus] = useState<AegisStatus | null>(null);
  const [wallets, setWallets] = useState<AegisWalletInfo[]>([]);
  const [keyword, setKeyword] = useState<string>('crypto');
  const [services, setServices] = useState<MarketService[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [statusR, walletsR] = await Promise.allSettled([
      api.get<AegisStatus>('/aegis/status'),
      api.get<{ wallets: AegisWalletInfo[] }>('/aegis/wallets'),
    ]);
    if (statusR.status === 'fulfilled') {
      setStatus(statusR.value);
    } else {
      setStatus(null);
      setLoadError(statusR.reason instanceof Error ? statusR.reason.message : 'Failed to load Aegis status');
    }
    setWallets(walletsR.status === 'fulfilled' ? (walletsR.value.wallets || []) : []);
    setLoading(false);
  }, []);

  useEffect(() => { if (ready) loadStatus(); }, [ready, loadStatus]);

  const loadMarket = useCallback((kw: string) => {
    setMarketLoading(true);
    setMarketError(null);
    api.get<{ services: MarketService[] }>(`/aegis/services/search?keyword=${encodeURIComponent(kw)}`)
      .then(r => setServices(r.services || []))
      .catch((e: Error) => { setMarketError(e.message || 'search failed'); setServices([]); })
      .finally(() => setMarketLoading(false));
  }, []);

  useEffect(() => {
    if (!ready || !status?.loggedIn) return;
    loadMarket(keyword);
  }, [ready, status?.loggedIn, keyword, loadMarket]);

  const total = wallets.reduce((s, w) => s + (parseFloat(w.balanceUsdc) || 0) + (parseFloat(w.gatewayBalanceUsdc) || 0), 0);

  const agentStatusLabel = status?.loggedIn
    ? 'ACTIVE'
    : status?.termsAccepted
    ? 'AWAITING LOGIN'
    : status?.cliInstalled
    ? 'TERMS PENDING'
    : 'CLI MISSING';

  const agentStatusPill = status?.loggedIn ? 'ga-pill ga-pill-ok' : 'ga-pill ga-pill-warn';

  if (loading && !status) {
    return (
      <div className="arc-page">
        <div className="arc-kpi-row">
          {[1, 2, 3].map((i) => (
            <div className="arc-kpi" key={i}>
              <Skeleton width="60%" height={12} style={{ marginBottom: 8 }} />
              <Skeleton width="40%" height={22} />
            </div>
          ))}
        </div>
        <div className="arc-card">
          <div className="arc-card-head"><span className="arc-card-title">Session</span></div>
          <div style={{ padding: '14px 18px' }}>
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} width="100%" height={10} style={{ marginBottom: 10 }} />)}
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="arc-page">
        <ErrorState title="Aegis status unavailable" message={loadError} onRetry={loadStatus} />
      </div>
    );
  }

  return (
    <div className="arc-page">
      <div className="arc-kpi-row">
        <div className="arc-kpi">
          <div className="arc-kpi-label">Agent status</div>
          <div className="arc-kpi-value"><span className={agentStatusPill}>{agentStatusLabel}</span></div>
        </div>
        <div className="arc-kpi">
          <div className="arc-kpi-label">Total USDC</div>
          <div className="arc-kpi-value">{total.toFixed(4)}</div>
        </div>
        <div className="arc-kpi">
          <div className="arc-kpi-label">Chains</div>
          <div className="arc-kpi-value">{wallets.length}</div>
        </div>
      </div>

      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconShield size={13} /> Session</span>
        </div>
        <div style={{ padding: '14px 18px' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['CLI version', status?.cliVersion ?? '-'],
                ['Email', status?.email ? status.email.replace(/^(.{3}).*@/, '$1•••@') : '-'],
                ['Terms accepted', status?.termsAccepted ? 'yes' : 'no'],
                ['Session expires', status?.sessionExpiresAt ?? (status?.loggedIn ? 'in 7d' : '-')],
                ['Default chain', status?.defaultChain ?? '-'],
                ['Cap per call', status ? `${status.maxPerCallUsdc} USDC` : '-'],
              ].map(([k, v]) => (
                <tr key={k} style={{ borderBottom: '1px solid var(--line-1)' }}>
                  <td style={{ padding: '7px 0', color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: '40%' }}>{k}</td>
                  <td style={{ padding: '7px 0', fontFamily: 'var(--font-mono)', color: 'var(--ink-2)', textAlign: 'right' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconZap size={13} /> Balances by chain</span>
        </div>
        {wallets.length === 0 ? (
          <div className="arc-empty">No wallets. Aegis not bootstrapped yet.</div>
        ) : (
          <div className="arc-table-wrap">
            <table className="arc-table">
              <thead>
                <tr>
                  <th>Chain</th>
                  <th>Vanilla USDC</th>
                  <th>Gateway USDC</th>
                </tr>
              </thead>
              <tbody>
                {wallets.map((w) => (
                  <tr key={w.chain}>
                    <td style={{ fontWeight: 500 }}>{w.chain}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{parseFloat(w.balanceUsdc || '0').toFixed(4)}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{parseFloat(w.gatewayBalanceUsdc || '0').toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total === 0 && wallets.length > 0 && (
          <div style={{ padding: '10px 18px 14px', fontSize: 11, color: 'var(--ink-3)' }}>
            Fund this wallet on Base mainnet (~$5 USDC) to enable paid x402 calls.
          </div>
        )}
      </div>

      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconSettings size={13} /> Agent Marketplace</span>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Cap: {status?.maxPerCallUsdc ?? '0.10'} USDC/call</span>
        </div>
        <div style={{ padding: '14px 18px' }}>
          <div className="arc-tab-bar" style={{ marginBottom: 14 }}>
            {KEYWORDS.map((kw) => (
              <button
                key={kw}
                className={`arc-tab${keyword === kw ? ' arc-tab-active' : ''}`}
                onClick={() => setKeyword(kw)}
                disabled={!status?.loggedIn || marketLoading}
              >{kw}</button>
            ))}
          </div>
          {!status?.loggedIn ? (
            <div className="arc-empty">{status?.message ?? 'Aegis CLI not bootstrapped.'}</div>
          ) : marketError ? (
            <div style={{ fontSize: 12, color: 'var(--err)', padding: '8px 0' }}>Marketplace error: {marketError}</div>
          ) : marketLoading ? (
            <div className="arc-empty">Searching...</div>
          ) : services.length === 0 ? (
            <div className="arc-empty">No services for &ldquo;{keyword}&rdquo;.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 8 }}>
              {services.slice(0, 12).map((s, i) => (
                <div key={i} style={{ background: 'var(--bg-3)', border: '1px solid var(--line-1)', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{s.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all', marginBottom: 4 }}>{s.url}</div>
                  {s.description && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>{s.description}</div>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                    <span style={{ fontSize: 9, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.chains.join(' · ') || '-'}</span>
                    <span style={{ color: 'var(--ok)', fontFamily: 'var(--font-mono)' }}>{s.price} USDC</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!status?.loggedIn && (
        <div className="arc-card" style={{ borderColor: 'var(--amber-300)' }}>
          <div className="arc-card-head">
            <span className="arc-card-title">Bootstrap instructions</span>
          </div>
          <div style={{ padding: '14px 18px' }}>
            <p style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: 10 }}>
              Aegis-wallet uses the Circle CLI inside the backend container. To activate, run these in your operator terminal:
            </p>
            <pre style={{
              background: 'var(--bg-1)', padding: 12, borderRadius: 8, fontSize: 11,
              fontFamily: 'var(--font-mono)', color: 'var(--ink-2)', overflowX: 'auto',
            }}>{`sudo docker exec -it guardagentai_backend sh\ncircle terms accept\ncircle wallet login your@email.com --type agent --init\n# check email for OTP, then:\ncircle wallet login --type agent --request <id> --otp <code>\ncircle wallet create --output json`}</pre>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>See AEGIS_WALLET_BOOTSTRAP.md in the repo for full details.</div>
          </div>
        </div>
      )}
    </div>
  );
}
