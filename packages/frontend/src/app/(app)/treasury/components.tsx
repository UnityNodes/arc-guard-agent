'use client';
import React from 'react';
import { IconShield, IconCheck, IconExternal } from '@/components/Icons';

export type Decision = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export type Section<T> = { ok: true; data: T } | { ok: false; error: string };

export function sectionData<T>(s: Section<T> | undefined, fallback: T): T {
  return s && s.ok ? s.data : fallback;
}
export function sectionError<T>(s: Section<T> | undefined): string | null {
  return s && !s.ok ? s.error : null;
}

// One verdict chip for every guarded action, so allow, deny and approval all
// read the same way wherever they appear.
export function GuardianVerdict({ decision, reasons }: { decision: Decision | null; reasons?: string[] }) {
  if (!decision) return null;
  const cls =
    decision === 'ALLOW' ? 'ga-pill ga-pill-ok'
    : decision === 'DENY' ? 'ga-pill ga-pill-err'
    : 'ga-pill ga-pill-warn';
  const label =
    decision === 'ALLOW' ? 'Guardian: allow'
    : decision === 'DENY' ? 'Guardian: blocked'
    : 'Guardian: needs approval';
  return (
    <div style={{ marginTop: 8 }}>
      <span className={cls} style={{ fontSize: 10 }}>
        {decision === 'ALLOW' ? <IconCheck size={10}/> : <IconShield size={10}/>} {label}
      </span>
      {reasons && reasons.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          {reasons.join('; ')}
        </div>
      )}
    </div>
  );
}

export function CardShell({
  title, icon, right, error, children,
}: {
  title: string;
  icon: React.ReactNode;
  right?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="arc-card">
      <div className="arc-card-head">
        <span className="arc-card-title">{icon} {title}</span>
        {right && <div className="arc-card-head-right">{right}</div>}
      </div>
      {error ? (
        <div className="arc-empty" style={{ padding: '22px 16px' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Unavailable right now</div>
          <div style={{ fontSize: 11, color: 'var(--ink-4, var(--ink-3))', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{error}</div>
        </div>
      ) : children}
    </div>
  );
}

export function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--line-1)' }}>
      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{label}</span>
      <span style={{ fontSize: 12.5, color: 'var(--ink-1)', fontFamily: mono ? 'var(--font-mono)' : undefined, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

export function ExplorerLink({ hash, base }: { hash: string; base: string }) {
  return (
    <a className="arc-link-btn" href={`${base}/tx/${hash}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
      {hash.slice(0, 8)}…{hash.slice(-4)} <IconExternal size={10}/>
    </a>
  );
}
