'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  IconDownload, IconLogout, IconTelegram, IconFaucet, IconCheck, IconCopy,
  IconSettings, IconShield, IconBell, IconUser, IconZap, IconClose, IconSparkle,
} from '@/components/Icons';
import { TokenMark } from '@/components/Atoms';
import { Term } from '@/components/Term';
import { useBackendAuth } from '@/hooks/useBackendAuth';
import { useToast } from '@/components/ui/toast';
import { api, setApiToken } from '@/lib/api';

const ARC_EXPLORER = 'https://testnet.arcscan.app';

interface UserData {
  walletAddress: string;
  email: string | null;
  telegramChatId: string | null;
  telegramLinked: boolean;
  autoMode: boolean;
}

interface WebhookStatus {
  configured: boolean;
  endpoint: string;
  eventsLast24h: number;
  lastEventAt: string | null;
  isPlatformAdmin: boolean;
  managementEnabled: boolean;
}

interface WebhookEvent {
  id: string;
  at: string;
  type: string;
  verified: boolean;
  reconciled: string | null;
  txHash: string | null;
  state: string | null;
}

interface WebhookSubscription {
  id: string;
  name: string | null;
  endpoint: string;
  enabled: boolean;
  restricted: boolean | null;
  notificationTypes: string[] | null;
  createDate: string | null;
  updateDate: string | null;
  isOurs: boolean;
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function SettingRow({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', lineHeight: 1.4 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { ready } = useBackendAuth();
  const toast = useToast();
  const router = useRouter();
  const signOut = async () => {
    try { await api.post('/auth/logout', {}); } catch { /* ignore */ }
    setApiToken(null);
    router.push('/sign-in');
  };
  const [loading, setLoading] = useState(true);

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState<string | null>(null);
  const [telegramCode, setTelegramCode] = useState<string | null>(null);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus | null>(null);
  const [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>([]);
  const [registeringWebhook, setRegisteringWebhook] = useState(false);
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [subBusy, setSubBusy] = useState<string | null>(null);

  const [faucetSel, setFaucetSel] = useState<{ usdc: boolean; eurc: boolean; native: boolean }>({ usdc: true, eurc: false, native: false });
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [agentAddress, setAgentAddress] = useState<string | null>(null);
  const [signMsg, setSignMsg] = useState('');
  const [signBusy, setSignBusy] = useState(false);
  const [signSig, setSignSig] = useState<string | null>(null);
  const [sigCopied, setSigCopied] = useState(false);
  const [walletResetting, setWalletResetting] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);

  async function handleSeedDemo() {
    if (seedBusy) return;
    setSeedBusy(true);
    try {
      const r = await api.post<{ ok: boolean; created?: number; skipped?: string; count?: number }>('/rules/seed-demo', {});
      if (r.skipped) {
        toast.info('Already have rules', `You already have ${r.count ?? 'some'} rules. Taking you to /alerts so you can see them.`);
      } else {
        toast.success('Demo data seeded', `${r.created ?? 0} starter rules created. Taking you to /alerts to see them.`);
      }
      setTimeout(() => router.push('/alerts'), 350);
    } catch (err) {
      toast.error('Seed failed', err instanceof Error ? err.message : undefined);
    } finally {
      setSeedBusy(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    api.get<{ user: UserData }>('/users/me')
      .then((userRes) => {
        const u = userRes.user;
        setWalletAddress(u.walletAddress ?? null);
        setEmail(u.email ?? null);
        setTelegramLinked(u.telegramLinked ?? false);
        setTelegramChatId(u.telegramChatId ?? null);
      })
      .catch(() => toast.error('Could not load settings', 'Refresh to try again'))
      .finally(() => setLoading(false));
    api.get<{ wallet: { agentAddress: string } | null }>('/agent-wallet')
      .then((d) => setAgentAddress(d.wallet?.agentAddress ?? null))
      .catch(() => setAgentAddress(null));
    loadWebhooks();
  }, [ready]);

  async function loadWebhooks() {
    try {
      const [s, e] = await Promise.all([
        api.get<WebhookStatus>('/webhooks/status'),
        api.get<{ events: WebhookEvent[] }>('/webhooks/events?limit=8'),
      ]);
      setWebhookStatus(s);
      setWebhookEvents(e.events ?? []);
      try {
        const subs = await api.get<{ subscriptions: WebhookSubscription[] }>('/webhooks/subscriptions');
        setSubscriptions(subs.subscriptions ?? []);
      } catch { setSubscriptions([]); }
    } catch { /* ignore */ }
  }

  async function handleRegisterWebhook() {
    if (registeringWebhook) return;
    setRegisteringWebhook(true);
    try {
      const r = await api.post<{ reused?: boolean }>('/webhooks/register', {});
      toast.success(r?.reused ? 'Webhook already registered' : 'Webhook registered', 'Circle will now push wallet events in real time.');
      await loadWebhooks();
    } catch (err) {
      toast.error('Could not register webhook', err instanceof Error ? err.message : undefined);
    } finally {
      setRegisteringWebhook(false);
    }
  }

  async function handleToggleSubscription(sub: WebhookSubscription) {
    setSubBusy(sub.id);
    try {
      await api.patch(`/webhooks/subscriptions/${sub.id}`, { enabled: !sub.enabled });
      toast.success(sub.enabled ? 'Subscription paused' : 'Subscription enabled');
      await loadWebhooks();
    } catch (err) {
      toast.error('Could not update subscription', err instanceof Error ? err.message : undefined);
    } finally {
      setSubBusy(null);
    }
  }

  async function handleDeleteSubscription(sub: WebhookSubscription) {
    if (!confirm(`Remove subscription "${sub.name || sub.id.slice(0, 8)}"? Circle will stop pushing events to this endpoint.`)) return;
    setSubBusy(sub.id);
    try {
      await api.delete(`/webhooks/subscriptions/${sub.id}`);
      toast.success('Subscription removed');
      await loadWebhooks();
    } catch (err) {
      toast.error('Could not delete subscription', err instanceof Error ? err.message : undefined);
    } finally {
      setSubBusy(null);
    }
  }

  async function handleConnectTelegram() {
    try {
      const res = await api.post<{ code: string; instruction: string }>('/users/telegram/link', {});
      setTelegramCode(res.code);
      toast.info('Link code generated', res.instruction);
    } catch (err) {
      toast.error('Could not generate link code', err instanceof Error ? err.message : undefined);
    }
  }

  async function handleTestTelegram() {
    if (telegramTesting) return;
    setTelegramTesting(true);
    try {
      await api.post('/users/telegram/test', {});
      toast.success('Test message sent', 'Check your Telegram chat.');
    } catch (err) {
      toast.error('Test failed', err instanceof Error ? err.message : undefined);
    } finally {
      setTelegramTesting(false);
    }
  }

  async function handleExportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const [txRes, alertsRes] = await Promise.all([
        api.get<{ transactions: Array<{ id: string; type: string; tokenIn?: string; tokenOut?: string; amount?: string; amountUsd?: number; toAddress?: string; txHash?: string; status?: string; createdAt: string }> }>('/agent-wallet/transactions').catch(() => ({ transactions: [] })),
        api.get<{ alerts: Array<{ id: string; label?: string; condition?: string; status?: string; createdAt?: string }> }>('/alerts?limit=200').catch(() => ({ alerts: [] })),
      ]);
      const headers = ['Kind', 'ID', 'Type/Condition', 'Detail', 'AmountUSD', 'Status', 'Hash', 'CreatedAt'];
      const rows: (string | number)[][] = [];
      for (const t of txRes.transactions || []) {
        rows.push([
          'transaction', t.id, t.type,
          t.tokenIn && t.tokenOut ? `${t.amount ?? ''} ${t.tokenIn}->${t.tokenOut}` : (t.toAddress ?? ''),
          t.amountUsd ?? '', t.status ?? '', t.txHash ?? '', t.createdAt,
        ]);
      }
      for (const a of alertsRes.alerts || []) {
        rows.push(['alert', a.id, a.condition ?? a.label ?? '', '', '', a.status ?? '', '', a.createdAt ?? '']);
      }
      if (rows.length === 0) { toast.info('Nothing to export', 'No transactions or alerts yet.'); return; }
      downloadCsv(`guardagent-export-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, rows));
    } finally {
      setExporting(false);
    }
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      setSigningOut(false);
    }
  }

  function handleFaucet() {
    if (faucetBusy) return;
    if (!faucetSel.usdc && !faucetSel.eurc && !faucetSel.native) {
      toast.error('Pick a token', 'Choose at least one of USDC, EURC or Gas');
      return;
    }
    setFaucetBusy(true);
    const tokens = [faucetSel.usdc && 'USDC', faucetSel.eurc && 'EURC', faucetSel.native && 'Gas'].filter(Boolean).join(', ');
    if (agentAddress) {
      navigator.clipboard.writeText(agentAddress).catch(() => {});
      toast.success('Address copied', `Paste it in the Circle faucet, select Arc Testnet and request ${tokens}`);
    } else {
      toast.success('Opening Circle faucet', `Select Arc Testnet and request ${tokens} for your agent wallet address`);
    }
    window.open('https://faucet.circle.com', '_blank', 'noopener,noreferrer');
    setTimeout(() => setFaucetBusy(false), 1500);
  }

  async function handleSignMessage() {
    if (signBusy || !signMsg.trim()) return;
    setSignBusy(true); setSignSig(null);
    const t = toast.pending('Signing…', 'Asking the agent key for a signature');
    try {
      const r = await api.post<{ signature: string }>('/agent-wallet/sign-message', { message: signMsg });
      setSignSig(r.signature);
      t.success('Signed', 'Signature ready, copy from below');
    } catch (err) {
      t.error('Sign failed', err instanceof Error ? err.message : undefined);
    } finally {
      setSignBusy(false);
    }
  }

  async function handleWalletReset() {
    if (!confirm('Detach the agent wallet record? The underlying Circle wallet is NOT deleted.')) return;
    setWalletResetting(true);
    const t = toast.pending('Detaching agent wallet…');
    try {
      await api.delete('/agent-wallet');
      t.success('Agent wallet detached', 'You can create a fresh one on the Wallet page.');
    } catch (err) {
      t.error('Reset failed', err instanceof Error ? err.message : undefined);
    } finally {
      setWalletResetting(false);
    }
  }

  const channelStatus = useMemo(() => {
    const telegram = telegramLinked ? 'ok' : 'off';
    const webhook = webhookStatus?.configured ? 'ok' : 'off';
    const identity = email ? 'email' : walletAddress ? 'wallet' : 'none';
    return { telegram, webhook, identity };
  }, [telegramLinked, webhookStatus, email, walletAddress]);

  if (loading) {
    return (
      <div className="arc-page">
        <div className="arc-card">
          <div className="arc-empty">Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="arc-page">

      {/* KPI strip */}
      <div className="arc-kpi-row">
        <div className="arc-kpi">
          <div className="arc-kpi-label"><IconTelegram size={11}/> Telegram</div>
          <div className="arc-kpi-val">
            <span className={`ga-pill ${channelStatus.telegram === 'ok' ? 'ga-pill-ok' : 'ga-pill-warn'}`}>
              {channelStatus.telegram === 'ok' ? 'Connected' : 'Not linked'}
            </span>
          </div>
        </div>
        <div className="arc-kpi">
          <div className="arc-kpi-label"><IconZap size={11}/> Circle push</div>
          <div className="arc-kpi-val">
            <span className={`ga-pill ${channelStatus.webhook === 'ok' ? 'ga-pill-ok' : 'ga-pill-warn'}`}>
              {channelStatus.webhook === 'ok' ? `${webhookStatus?.eventsLast24h ?? 0} / 24h` : 'Not registered'}
            </span>
          </div>
        </div>
        <div className="arc-kpi">
          <div className="arc-kpi-label"><IconUser size={11}/> Identity</div>
          <div className="arc-kpi-val" style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {email || (walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : '-')}
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconBell size={13}/> Notifications</span>
        </div>
        <SettingRow label="Telegram bot" desc="Instant pings when alerts fire or actions execute.">
          {telegramLinked ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="ga-pill ga-pill-ok">
                <IconTelegram size={11}/> {telegramChatId ? `@${telegramChatId}` : 'Connected'}
              </span>
              <button className="arc-btn arc-btn-secondary" onClick={handleTestTelegram} disabled={telegramTesting}>
                {telegramTesting ? 'Sending…' : 'Test'}
              </button>
              <button className="arc-btn arc-btn-secondary" onClick={async () => {
                try {
                  await api.delete('/users/telegram');
                  setTelegramLinked(false);
                  setTelegramChatId(null);
                  setTelegramCode(null);
                  toast.success('Telegram disconnected');
                } catch (err) {
                  toast.error('Could not disconnect Telegram', err instanceof Error ? err.message : 'Try again');
                }
              }}>Disconnect</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
              <button className="arc-btn arc-btn-primary" onClick={handleConnectTelegram}>
                <IconTelegram size={13}/> {telegramCode ? 'New code' : 'Connect Telegram'}
              </button>
              {telegramCode && (
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                  Send <code className="font-mono" style={{ background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 3 }}>/link {telegramCode}</code> to <strong>@guard_agent_ai_bot</strong>. Expires in 10 min.
                </div>
              )}
            </div>
          )}
        </SettingRow>
      </div>

      {/* Real-time push */}
      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconZap size={13}/> Real-time push</span>
        </div>
        <SettingRow label="Push channel" desc="Signed Ed25519 notifications delivered to the agent endpoint.">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className={`ga-pill ${webhookStatus?.configured ? 'ga-pill-ok' : 'ga-pill-warn'}`}>
              {webhookStatus?.configured ? 'Configured' : 'Not configured'}
            </span>
            <button
              className="arc-btn arc-btn-secondary"
              onClick={handleRegisterWebhook}
              disabled={registeringWebhook || !webhookStatus?.configured || !webhookStatus?.isPlatformAdmin}
              title={!webhookStatus?.isPlatformAdmin ? 'Platform admin only' : undefined}
            >
              {registeringWebhook ? 'Registering…' : 'Register webhook'}
            </button>
          </div>
        </SettingRow>

        <SettingRow label="Last 24h" desc="Events received in the last day.">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{webhookStatus?.eventsLast24h ?? 0}</span>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              {webhookStatus?.lastEventAt ? `last ${new Date(webhookStatus.lastEventAt).toLocaleString()}` : 'no events yet'}
            </span>
          </div>
        </SettingRow>

        {webhookEvents.length > 0 && (
          <div style={{ padding: '8px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {webhookEvents.map((ev) => (
              <div key={ev.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                <span className={`ga-pill ${ev.verified ? 'ga-pill-ok' : 'ga-pill-warn'}`} style={{ fontSize: 10, padding: '1px 6px' }}>{ev.type}</span>
                {ev.reconciled && <span className="ga-pill" style={{ fontSize: 10 }}>{ev.reconciled.replace(/_/g, ' ')}</span>}
                {ev.txHash && (
                  <a className="font-mono" style={{ fontSize: 11, color: 'var(--accent)' }} href={`${ARC_EXPLORER}/tx/${ev.txHash}`} target="_blank" rel="noopener noreferrer">
                    {ev.txHash.slice(0, 10)}…
                  </a>
                )}
                <span style={{ fontSize: 11, color: 'var(--fg-muted)', marginLeft: 'auto' }}>{new Date(ev.at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-muted)' }}>Subscriptions</span>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              {webhookStatus?.managementEnabled
                ? (webhookStatus.isPlatformAdmin ? 'Platform admin' : 'Read-only')
                : 'Management disabled (PLATFORM_ADMIN_WALLETS unset)'}
            </span>
          </div>
          {subscriptions.length === 0 ? (
            <div className="arc-empty" style={{ padding: '12px 0' }}>No subscriptions registered with Circle yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {subscriptions.map((s) => (
                <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className={`ga-pill ${s.enabled ? 'ga-pill-ok' : 'ga-pill-warn'}`} style={{ fontSize: 10 }}>{s.enabled ? 'on' : 'off'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span>{s.name || s.id.slice(0, 8)}</span>
                      {s.isOurs && <span className="ga-pill ga-pill-ok" style={{ fontSize: 10 }}>this agent</span>}
                      {s.restricted && <span className="ga-pill" style={{ fontSize: 10 }}>restricted</span>}
                    </div>
                    <div className="font-mono" style={{ fontSize: 10, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.endpoint}</div>
                  </div>
                  {webhookStatus?.isPlatformAdmin && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="arc-btn arc-btn-secondary" onClick={() => handleToggleSubscription(s)} disabled={subBusy === s.id}>
                        {s.enabled ? 'Pause' : 'Enable'}
                      </button>
                      <button className="arc-btn arc-btn-secondary" style={{ color: 'var(--err)' }} onClick={() => handleDeleteSubscription(s)} disabled={subBusy === s.id}>
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Identity */}
      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconUser size={13}/> Identity</span>
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
            <span style={{ color: 'var(--fg-muted)', minWidth: 100 }}>Auth provider</span>
            <span><Term>Privy</Term> email OTP</span>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
            <span style={{ color: 'var(--fg-muted)', minWidth: 100 }}>Identity</span>
            <span className="font-mono">{email || walletAddress || '-'}</span>
          </div>
          {walletAddress && (
            <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
              <span style={{ color: 'var(--fg-muted)', minWidth: 100 }}>Wallet</span>
              <a
                className="font-mono"
                style={{ color: 'var(--accent)', wordBreak: 'break-all' }}
                href={`${ARC_EXPLORER}/address/${walletAddress}`}
                target="_blank" rel="noopener noreferrer"
              >
                {walletAddress}
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Account */}
      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconShield size={13}/> Account</span>
        </div>
        <SettingRow label="Export data" desc="CSV of all transactions and alerts.">
          <button className="arc-btn arc-btn-secondary" onClick={handleExportCsv} disabled={exporting}>
            <IconDownload size={13}/> {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </SettingRow>
        <SettingRow label="Sign out" desc="Revoke this session. Your agent will pause until next sign-in.">
          <button className="arc-btn arc-btn-secondary" style={{ color: 'var(--err)' }} onClick={handleSignOut} disabled={signingOut}>
            <IconLogout size={13}/> {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </SettingRow>
      </div>

      {/* Developer */}
      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconSettings size={13}/> Developer</span>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Trial mode · Arc Testnet only</span>
        </div>
        <div style={{ padding: '10px 18px', fontSize: 12, color: 'var(--fg-muted)', borderBottom: '1px solid var(--border)' }}>
          Running on <strong style={{ color: 'var(--fg)' }}>Arc Testnet</strong>. Tokens are free fakes. These tools fund the agent wallet and prove key ownership without leaving the app.
        </div>

        <SettingRow
          label="Drop testnet tokens"
          desc="Pick which test tokens you want, then open the Circle faucet. We copy the agent wallet address to your clipboard so you can paste it on faucet.circle.com (pick Arc Testnet). USDC and EURC are stablecoins; Gas is the native token Arc uses to pay for transactions."
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {([['usdc', 'USDC'], ['eurc', 'EURC'], ['native', 'Gas']] as const).map(([key, lbl]) => {
              const active = faucetSel[key];
              return (
                <button
                  key={key}
                  onClick={() => setFaucetSel(s => ({ ...s, [key]: !s[key] }))}
                  className={`arc-btn ${active ? 'arc-btn-primary' : 'arc-btn-secondary'}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  {key !== 'native' && <TokenMark symbol={lbl} size={14}/>}
                  {lbl}
                  {active && <IconCheck size={11}/>}
                </button>
              );
            })}
            <button className="arc-btn arc-btn-secondary" disabled={faucetBusy} onClick={handleFaucet} title="Copy agent address and open the Circle faucet (Arc Testnet)">
              <IconFaucet size={13}/> {faucetBusy ? 'Opening…' : 'Open Circle faucet'}
            </button>
          </div>
        </SettingRow>

        <SettingRow
          label="Seed demo data"
          desc="Creates 3 starter price-watch rules so /alerts and /dashboard look populated. Idempotent: runs once per account."
        >
          <button className="arc-btn arc-btn-secondary" disabled={seedBusy} onClick={handleSeedDemo}>
            <IconSparkle size={13}/> {seedBusy ? 'Seeding…' : 'Seed 3 rules'}
          </button>
        </SettingRow>

        <SettingRow
          label="Sign with agent key"
          desc="Sign an arbitrary message with the agent's wallet key. Useful for proving the agent address to third-party services."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', minWidth: 240 }}>
            <textarea
              className="ga-input"
              rows={2}
              placeholder="Message to sign with the agent key…"
              maxLength={2000}
              value={signMsg}
              onChange={e => { setSignMsg(e.target.value); setSignSig(null); }}
              style={{ width: '100%' }}
            />
            <button className="arc-btn arc-btn-secondary" disabled={signBusy || !signMsg.trim()} onClick={handleSignMessage}>
              {signBusy ? 'Signing…' : 'Sign'}
            </button>
            {signSig && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'var(--surface-2)', borderRadius: 4, padding: '4px 8px', width: '100%' }}>
                <code className="font-mono" style={{ fontSize: 10, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{signSig}</code>
                <button
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)', padding: 2 }}
                  onClick={() => { navigator.clipboard.writeText(signSig).catch(() => {}); setSigCopied(true); setTimeout(() => setSigCopied(false), 1500); }}
                >
                  {sigCopied ? <IconCheck size={14} style={{ color: 'var(--ok)' }}/> : <IconCopy size={14}/>}
                </button>
              </div>
            )}
          </div>
        </SettingRow>
      </div>

      {/* Danger zone */}
      <div className="arc-card" style={{ borderColor: 'var(--err)' }}>
        <div className="arc-card-head">
          <span className="arc-card-title" style={{ color: 'var(--err)' }}><IconClose size={13}/> Danger zone</span>
        </div>
        <SettingRow label="Reset agent wallet" desc="Detaches the agent wallet record from GuardAgent. The underlying Circle wallet is NOT deleted. You can then create a fresh agent wallet on the Wallet page.">
          <button className="arc-btn arc-btn-secondary" style={{ color: 'var(--err)', borderColor: 'var(--err)' }} disabled={walletResetting} onClick={handleWalletReset}>
            {walletResetting ? 'Resetting…' : 'Reset agent wallet'}
          </button>
        </SettingRow>
      </div>

    </div>
  );
}
