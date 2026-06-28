'use client';
import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { BrandMark } from '@/components/Icons';
import {
  IconWallet, IconBell, IconBuilding, IconSearch,
  IconChat, IconSettings, IconShield, IconSparkle,
} from '@/components/Icons';
import { api } from '@/lib/api';
import { useBackendAuth } from '@/hooks/useBackendAuth';

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}

// Sidebar icons mirror each page's hero mark so the brand reads the same in
// the navigator and on the page itself. Chat sits at the very top because
// talking to Aegis is the main product surface, not an afterthought.
const navAegis: NavItem[] = [
  { id: 'chat',      label: 'Chat',      icon: IconChat },
];

const navMain: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: IconSparkle },
  { id: 'wallet',    label: 'Wallet',    icon: IconWallet },
  { id: 'jobs',      label: 'Jobs',      icon: IconBuilding },
  { id: 'guardian',  label: 'Guardian',  icon: IconShield },
  { id: 'alerts',    label: 'Alerts',    icon: IconBell },
];

const navHistory: NavItem[] = [
  { id: 'audit',     label: 'Log',       icon: IconSearch },
];

const navFoot: NavItem[] = [
  { id: 'settings',  label: 'Settings',  icon: IconSettings },
];

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { ready } = useBackendAuth();
  const [alertCount, setAlertCount] = useState<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    api.get<{ rules: unknown[] }>('/rules')
      .then(d => setAlertCount(d.rules?.length ?? 0))
      .catch(() => {});
  }, [ready]);

  const route = pathname.split('/')[1] || 'dashboard';

  const renderItem = (n: NavItem) => {
    const I = n.icon;
    const active = route === n.id;
    return (
      <button
        key={n.id}
        className={`ga-nav-item${active ? ' is-active' : ''}`}
        onClick={() => router.push(`/${n.id}`)}
      >
        <I size={14}/>
        <span className="ga-nav-item-label">{n.label}</span>
        {n.id === 'alerts' && alertCount !== null && alertCount > 0 && (
          <span className="ga-nav-badge">{alertCount}</span>
        )}
      </button>
    );
  };

  return (
    <aside className="ga-sidebar">
      <button className="ga-sidebar-brand" onClick={() => router.push('/')}>
        <BrandMark size={26}/>
        <div className="ga-sidebar-brand-text">
          <span className="ga-sidebar-brand-name">GuardAgent</span>
          <span className="ga-sidebar-brand-sub">Arc Testnet</span>
        </div>
      </button>

      <div className="ga-nav-section">
        <div className="ga-section-label ga-nav-section-label">Aegis</div>
        {navAegis.map(renderItem)}
      </div>

      <div className="ga-nav-section">
        <div className="ga-section-label ga-nav-section-label">Operate</div>
        {navMain.map(renderItem)}
      </div>

      <div className="ga-nav-section">
        <div className="ga-section-label ga-nav-section-label">History</div>
        {navHistory.map(renderItem)}
      </div>

      <div className="ga-nav-section">
        {navFoot.map(renderItem)}
      </div>

      <div style={{ flex: 1, minHeight: 14 }}/>

      <div className="arc-aegis-panel">
          <div className="arc-aegis-panel-head">
            <span className="arc-aegis-orb"/>
            <div style={{ flex: 1 }}>
              <div className="arc-aegis-name">Aegis</div>
              <div className="arc-aegis-sub">watching · arc</div>
            </div>
            <IconSparkle size={11} style={{ color: 'var(--amber-400)' }}/>
          </div>
          <div className="arc-aegis-stats">
            <div>
              <div className="arc-aegis-stat-label">tools</div>
              <div className="arc-aegis-stat-val">36</div>
            </div>
            <div>
              <div className="arc-aegis-stat-label">rules</div>
              <div className="arc-aegis-stat-val">{alertCount ?? '-'}</div>
            </div>
            <div>
              <div className="arc-aegis-stat-label">policy</div>
              <div className="arc-aegis-stat-val" style={{ color: 'var(--ok)' }}>on</div>
            </div>
          </div>
        </div>
    </aside>
  );
}
