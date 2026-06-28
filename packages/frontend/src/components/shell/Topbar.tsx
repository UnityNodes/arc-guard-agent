'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { IconSun, IconMoon, IconLogout, IconCopy, IconCheck, IconExternal, IconWallet, IconFaucet } from '@/components/Icons';
import { useAppShell } from '@/contexts/AppShellContext';
import { api, setApiToken } from '@/lib/api';
import { usePrivy } from '@privy-io/react-auth';
import { useToast } from '@/components/ui/toast';

const ARC_EXPLORER = 'https://testnet.arcscan.app';

const pageMeta: Record<string, { title: string; sub: string }> = {
  dashboard: { title: 'Dashboard',   sub: 'Overview and agent status' },
  activity:  { title: 'Activity',    sub: 'On-chain transactions' },
  alerts:    { title: 'Alerts',      sub: 'Rules and notifications' },
  wallet:    { title: 'Wallet',      sub: 'Agent wallet on Arc' },
  aegis:     { title: 'Aegis',       sub: 'AI agent status and tools' },
  guardian:  { title: 'Guardian',    sub: 'Spend policies and limits' },
  audit:     { title: 'Audit',       sub: 'Action log' },
  chat:      { title: 'Chat',        sub: 'Talk to your agent' },
  jobs:      { title: 'Jobs',        sub: 'ERC-8183 agentic commerce escrow' },
  settings:  { title: 'Settings',    sub: 'Telegram, auto-mode, account' },
};

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useAppShell();
  const { logout: privyLogout } = usePrivy();
  const route = pathname.split('/')[1] || 'dashboard';
  const meta = pageMeta[route] ?? pageMeta.dashboard;
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const [agentAddr, setAgentAddr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get<{ user: { email: string | null; walletAddress: string | null } }>('/auth/me')
      .then((d) => {
        const e = d.user?.email;
        const w = d.user?.walletAddress;
        setUserLabel(e ? e.split('@')[0] : w ? `${w.slice(0, 6)}…${w.slice(-4)}` : null);
      })
      .catch(() => setUserLabel(null));
    api.get<{ wallet: { agentAddress: string } | null }>('/agent-wallet')
      .then((d) => setAgentAddr(d.wallet?.agentAddress ?? null))
      .catch(() => setAgentAddr(null));
  }, []);

  const copyAgent = () => {
    if (!agentAddr) return;
    navigator.clipboard.writeText(agentAddr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleFaucet = () => {
    if (faucetBusy) return;
    setFaucetBusy(true);
    if (agentAddr) {
      navigator.clipboard.writeText(agentAddr).catch(() => {});
      toast.success('Address copied', 'Paste it in the Circle faucet and select Arc Testnet');
    } else {
      toast.success('Opening Circle faucet', 'Select Arc Testnet and paste your agent wallet address');
    }
    window.open('https://faucet.circle.com', '_blank', 'noopener,noreferrer');
    setTimeout(() => setFaucetBusy(false), 1500);
  };

  const signOut = async () => {
    try { await api.post('/auth/logout', {}); } catch { /* ignore */ }
    try { await privyLogout(); } catch { /* ignore */ }
    setApiToken(null);
    router.push('/sign-in');
  };

  return (
    <header className="topbar">
      <div>
        <div className="topbar-title">{meta.title}</div>
        {meta.sub && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{meta.sub}</div>}
      </div>
      <div style={{ flex: 1 }} />

      {/* Agent address, compact pill with copy + explorer */}
      {agentAddr && (
        <div className="ga-topbar-agent-pill">
          <IconWallet size={11} style={{ color: 'var(--ink-3)' }} />
          <span className="ga-topbar-agent-mono" title={agentAddr}>
            {agentAddr.slice(0, 6)}…{agentAddr.slice(-4)}
          </span>
          <button
            className="ga-topbar-agent-btn"
            onClick={copyAgent}
            title="Copy full address"
            style={copied ? { color: 'var(--ok)' } : undefined}
          >
            {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
          </button>
          <a
            className="ga-topbar-agent-btn"
            href={`${ARC_EXPLORER}/address/${agentAddr}`}
            target="_blank"
            rel="noopener noreferrer"
            title="View on Arcscan"
          >
            <IconExternal size={11} />
          </a>
        </div>
      )}

      {/* Faucet - always visible in topbar */}
      {agentAddr && (
        <button
          onClick={handleFaucet}
          disabled={faucetBusy}
          title="Copy agent address and open the Circle faucet (Arc Testnet)"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px',
            background: faucetBusy ? 'var(--bg-3)' : 'color-mix(in oklab, var(--amber-400) 12%, var(--bg-2))',
            border: `1px solid color-mix(in oklab, var(--amber-400) 35%, var(--line-1))`,
            borderRadius: 'var(--r-pill)',
            fontFamily: 'var(--font-sans)', fontSize: 11.5, fontWeight: 600,
            color: faucetBusy ? 'var(--ink-3)' : 'var(--amber-400)',
            cursor: faucetBusy ? 'not-allowed' : 'pointer',
            transition: 'all 120ms',
            letterSpacing: '0.02em',
          }}
        >
          <IconFaucet size={12}/>
          {faucetBusy ? 'Opening…' : 'Faucet'}
        </button>
      )}

      <div className="badge">
        <span className="dot dot-ok" />
        Arc Testnet
      </div>
      {userLabel && (
        <div className="badge" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          <span className="dot dot-ok" />
          {userLabel}
        </div>
      )}
      <button className="btn btn-ghost btn-icon" onClick={() => {
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('ga-theme-v2', next);
      }}>
        {theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
      </button>
      <button className="btn btn-ghost btn-icon" onClick={signOut} title="Sign out">
        <IconLogout size={14} />
      </button>
    </header>
  );
}
