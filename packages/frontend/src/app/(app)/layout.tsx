'use client';
import Link from 'next/link';
import { AppShellProvider } from '@/contexts/AppShellContext';
import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { ChatDock } from '@/components/shell/ChatDock';
import { BrandMark, IconShield, IconZap, IconWallet } from '@/components/Icons';
import { useBackendAuth } from '@/hooks/useBackendAuth';

function ConnectScreen() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-0)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, maxWidth: 400, width: '100%', padding: '0 24px' }}>
        <BrandMark size={56} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8, fontFamily: 'var(--font-sans)' }}>GuardAgent</div>
          <div style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            Autopilot for your stablecoins on Arc. Sign in to access your agent dashboard.
          </div>
        </div>

        <Link href="/sign-in" className="btn btn-agent btn-lg" style={{ width: '100%', textDecoration: 'none', textAlign: 'center' }}>
          Sign in
        </Link>

        <div style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'center' }}>
          Circle Wallet · MetaMask · embedded MPC, no seed phrases
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 8 }}>
          {([
            { Icon: IconShield, title: 'Non-custodial', desc: 'You hold your keys. The agent acts with your permission.' },
            { Icon: IconZap, title: 'Sub-second finality', desc: 'Arc Testnet. USDC-native, zero gas fees.' },
            { Icon: IconWallet, title: 'Agent wallet', desc: 'A delegated Circle wallet is created after first sign-in.' },
          ] as const).map(f => (
            <div key={f.title} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, padding: 14,
              background: 'var(--bg-2)', border: '1px solid var(--line-1)', borderRadius: 12,
            }}>
              <div style={{ width: 32, height: 32, borderRadius: 6, background: 'rgba(196,98,42,0.10)', display: 'grid', placeItems: 'center', color: 'var(--amber-400)', flexShrink: 0 }}>
                <f.Icon size={16} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{f.title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, checked } = useBackendAuth();
  // While we haven't finished the boot-time auth check, render a neutral
  // dark background instead of the full ConnectScreen, this prevents the
  // flicker where an authenticated user briefly sees the sign-in landing.
  if (!checked) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-0)' }} />;
  }
  if (!ready) return <ConnectScreen />;
  return (
    <div className="app-shell">
      <Sidebar />
      <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Topbar />
        {children}
      </main>
      <ChatDock />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShellProvider>
      <AppShell>{children}</AppShell>
    </AppShellProvider>
  );
}
