'use client';
import { useEffect } from 'react';
import {
  BrandMark, IconShield, IconSparkle, IconArrowRight, IconCheck,
  IconExternal, IconBridge, IconSwap, IconWallet, IconBuilding, IconChat,
} from '@/components/Icons';

const APP_URL = 'https://app.guardagent.org';

// ─── Shared tokens ───────────────────────────────────────────────────────────
const T = {
  bg:        '#FAF8F4',
  bg1:       '#F5F0E8',
  card:      '#FFFFFF',
  border:    'rgba(90,50,20,0.10)',
  border2:   'rgba(90,50,20,0.18)',
  ink1:      '#2B1A10',
  ink2:      '#6B4635',
  ink3:      '#9B7B6A',
  ink4:      '#BCA090',
  oxblood:   '#C4622A',
  oxblood2:  '#A84E1E',
  oxSoft:    'rgba(196,98,42,0.08)',
  ok:        '#1A7F4B',
  okSoft:    'rgba(26,127,75,0.10)',
  err:       '#B91C1C',
  errSoft:   'rgba(185,28,28,0.10)',
  warn:      '#B45309',
  warnSoft:  'rgba(180,83,9,0.10)',
  mono:      '"JetBrains Mono", ui-monospace, monospace',
  sans:      '"Oxanium", "Inter", sans-serif',
};

const r = { xs: '4px', sm: '4px', md: '6px', lg: '8px', pill: '999px' };

// ─── Nav ─────────────────────────────────────────────────────────────────────
function Nav() {
  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: `color-mix(in oklab, ${T.bg} 85%, transparent)`,
      backdropFilter: 'blur(16px)',
      borderBottom: `1px solid ${T.border}`,
    }}>
      <div style={{
        maxWidth: 1120, margin: '0 auto', padding: '0 28px',
        height: 56, display: 'flex', alignItems: 'center', gap: 32,
      }}>
        <a href="/" style={{
          display: 'flex', alignItems: 'center', gap: 9,
          textDecoration: 'none', color: T.ink1,
        }}>
          <BrandMark size={22}/>
          <span style={{
            fontFamily: T.sans, fontWeight: 700, fontSize: 13,
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>GuardAgent</span>
        </a>

        <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginLeft: 'auto' }}>
          {[
            { label: 'Product', href: '#product' },
            { label: 'Circle stack', href: '#deliverables' },
            { label: 'How it works', href: '#how' },
          ].map(l => (
            <a key={l.label} href={l.href}
              style={{
                fontFamily: T.sans, fontSize: 12.5, fontWeight: 500,
                color: T.ink3, textDecoration: 'none',
                letterSpacing: '0.02em',
                transition: 'color 120ms',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = T.ink1)}
              onMouseLeave={e => (e.currentTarget.style.color = T.ink3)}
            >{l.label}</a>
          ))}
          <a href={`${APP_URL}/sign-in`} style={{
            fontFamily: T.sans, fontSize: 12.5, fontWeight: 600,
            letterSpacing: '0.04em', textTransform: 'uppercase',
            padding: '7px 14px', background: T.oxblood, color: '#fff',
            borderRadius: r.sm, textDecoration: 'none',
            border: `1px solid ${T.oxblood2}`,
            transition: 'background 120ms',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = T.oxblood2)}
            onMouseLeave={e => (e.currentTarget.style.background = T.oxblood)}
          >Launch app</a>
        </div>
      </div>
    </nav>
  );
}

// ─── Mock product cards ───────────────────────────────────────────────────────
function MockBalance() {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`,
      borderRadius: r.lg, padding: '16px 18px', minWidth: 280,
      boxShadow: `0 4px 24px rgba(90,40,10,0.08)`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: T.sans, fontSize: 11, fontWeight: 600, color: T.ink3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          <IconWallet size={11}/> Agent wallet
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontFamily: T.mono, color: T.ok, background: T.okSoft, padding: '2px 8px', borderRadius: r.pill }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: T.ok }}/>live
        </span>
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 28, fontWeight: 600, color: T.ink1, letterSpacing: '-0.02em', marginBottom: 8 }}>$1,847.32</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[{ sym: 'U', label: '1,247.32 USDC', bg: '#2775ca' }, { sym: '€', label: '600.00 EURC', bg: '#3a78ff' }].map(t => (
          <span key={t.sym} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', background: T.bg1, border: `1px solid ${T.border}`, borderRadius: r.pill, fontSize: 11, fontFamily: T.mono, color: T.ink2 }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: t.bg, display: 'grid', placeItems: 'center', fontSize: 7, fontWeight: 700, color: '#fff' }}>{t.sym}</span>
            {t.label}
          </span>
        ))}
      </div>
      {/* sparkline */}
      <svg viewBox="0 0 240 28" style={{ width: '100%', height: 28 }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="spk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.oxblood} stopOpacity="0.20"/>
            <stop offset="100%" stopColor={T.oxblood} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d="M0 22 L26 18 L52 24 L80 12 L106 16 L132 8 L158 14 L184 5 L212 9 L240 3 L240 28 L0 28 Z" fill="url(#spk)"/>
        <path d="M0 22 L26 18 L52 24 L80 12 L106 16 L132 8 L158 14 L184 5 L212 9 L240 3" fill="none" stroke={T.oxblood} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10.5, fontFamily: T.mono }}>
        <span style={{ color: T.ink3 }}>7-day trend</span>
        <span style={{ color: T.ok, fontWeight: 600 }}>+12.4%</span>
      </div>
    </div>
  );
}

function MockPolicy() {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`,
      borderRadius: r.lg, padding: '14px 18px', minWidth: 220,
      boxShadow: `0 4px 24px rgba(90,40,10,0.08)`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontFamily: T.sans, fontSize: 11, fontWeight: 600, color: T.ink3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        <IconShield size={11}/> Guardian policy
      </div>
      {[
        { k: 'Per transaction', v: '$50.00' },
        { k: 'Daily limit', v: '$500.00' },
        { k: 'Allowed tokens', v: 'USDC, EURC' },
        { k: 'Slippage cap', v: '50 bps' },
      ].map(row => (
        <div key={row.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: `1px solid ${T.border}`, fontSize: 12 }}>
          <span style={{ color: T.ink3 }}>{row.k}</span>
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.ink1, fontWeight: 500 }}>{row.v}</span>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '6px 10px', background: T.okSoft, borderRadius: r.sm, fontSize: 11, color: T.ok, fontWeight: 600 }}>
        <IconCheck size={10}/> All within bounds
      </div>
    </div>
  );
}

function MockGuardian() {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: r.lg, padding: '16px 18px', boxShadow: `0 4px 24px rgba(90,40,10,0.08)` }}>
      <div style={{ fontFamily: T.sans, fontSize: 10.5, fontWeight: 600, color: T.ink3, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconShield size={10}/> Policy check · /Aegis
      </div>
      <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: r.md, padding: '8px 12px', marginBottom: 12, fontSize: 12 }}>
        <div style={{ color: T.ink3, fontSize: 10.5, marginBottom: 3, fontFamily: T.sans, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Requested</div>
        <div style={{ color: T.ink1, fontFamily: T.mono, fontSize: 12 }}>Bridge 1 USDC → base-sepolia</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {['Within per-tx cap ($50.00)', 'Within daily limit ($487 of $500)', 'Token USDC on allowlist'].map(txt => (
          <div key={txt} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: T.ok }}>
            <IconCheck size={10}/> <span style={{ color: T.ink2 }}>{txt}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: T.okSoft, borderRadius: r.sm }}>
        <span style={{ fontFamily: T.sans, fontSize: 10.5, fontWeight: 700, color: T.ok, letterSpacing: '0.05em', textTransform: 'uppercase' }}>ALLOW</span>
        <span style={{ fontSize: 11.5, color: T.ink2 }}>Submitting to CCTP</span>
      </div>
    </div>
  );
}

function MockChat() {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: r.lg, padding: '14px 16px', boxShadow: `0 4px 24px rgba(90,40,10,0.08)`, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* User message */}
      <div style={{ alignSelf: 'flex-end', background: T.bg1, border: `1px solid ${T.border}`, borderRadius: `${r.md} ${r.md} 2px ${r.md}`, padding: '8px 12px', maxWidth: '80%', fontSize: 12.5, color: T.ink1 }}>
        Bridge 1 USDC to base sepolia
      </div>
      {/* Agent message */}
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: T.oxblood, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgba(255,255,255,0.9)' }}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
            {['get_bridge_quote', 'execute_bridge'].map(t => (
              <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontFamily: T.mono, color: T.ok, background: T.okSoft, padding: '2px 7px', borderRadius: r.pill }}>
                <IconCheck size={8}/>{t}
              </span>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: T.ink2, marginBottom: 8 }}>Bridged. Burn on Arc, mint on Base Sepolia.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[{ label: 'burn', hash: '0xaa24…aaae' }, { label: 'mint', hash: '0xcc38…2bba' }].map(r2 => (
              <span key={r2.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontFamily: T.mono, color: T.oxblood }}>
                {r2.label} <code style={{ color: T.ink3 }}>{r2.hash}</code> <IconExternal size={9}/>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MockAudit() {
  const rows = [
    { v: 'ALLOW', color: T.ok, bg: T.okSoft, action: 'Bridge 1 USDC', detail: '→ base-sepolia', meta: '17:04 · rule allowlist' },
    { v: 'ALLOW', color: T.ok, bg: T.okSoft, action: 'Swap 2 USDC', detail: '→ EURC', meta: '16:58 · 12 bps slippage' },
    { v: 'BLOCKED', color: T.err, bg: T.errSoft, action: 'Send 500 USDC', detail: '→ 0x1234…', meta: '16:41 · over per-tx cap' },
  ];
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: r.lg, overflow: 'hidden', boxShadow: `0 4px 24px rgba(90,40,10,0.08)` }}>
      <div style={{ padding: '12px 18px', borderBottom: `1px solid ${T.border}`, fontFamily: T.sans, fontSize: 10.5, fontWeight: 600, color: T.ink3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        Audit log
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 18px', borderBottom: i < rows.length - 1 ? `1px solid ${T.border}` : 'none' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: row.color, marginTop: 5, flexShrink: 0 }}/>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
              <span style={{ fontFamily: T.sans, fontSize: 9.5, fontWeight: 700, color: row.color, background: row.bg, padding: '1px 6px', borderRadius: '3px', letterSpacing: '0.05em' }}>{row.v}</span>
              <span style={{ fontSize: 12, color: T.ink1, fontWeight: 500 }}>{row.action}</span>
              <span style={{ fontSize: 12, color: T.ink3 }}>{row.detail}</span>
            </div>
            <div style={{ fontSize: 10.5, fontFamily: T.mono, color: T.ink4 }}>{row.meta}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: T.sans, fontSize: 11, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: T.oxblood, marginBottom: 16 }}>
      <span style={{ width: 20, height: 1.5, background: T.oxblood, display: 'inline-block' }}/>
      {children}
      <span style={{ width: 20, height: 1.5, background: T.oxblood, display: 'inline-block' }}/>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  // Landing is always light/cream regardless of user's theme preference.
  // Force data-theme=light and set html/body background directly so there
  // is no dark flash on load for users who had dark stored in localStorage.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = html.getAttribute('data-theme');
    html.setAttribute('data-theme', 'light');
    body.style.background = T.bg;
    return () => {
      // Restore when leaving the landing page
      if (prev) html.setAttribute('data-theme', prev);
      else html.removeAttribute('data-theme');
      body.style.background = '';
    };
  }, []);

  return (
    <div style={{ background: T.bg, minHeight: '100vh', fontFamily: T.sans }}>
      <Nav/>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '80px 28px 100px', display: 'grid', gridTemplateColumns: '1fr 420px', gap: 64, alignItems: 'center' }}>
        <div>
          {/* live badge */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px', background: T.okSoft, border: `1px solid rgba(26,127,75,0.20)`, borderRadius: r.pill, fontSize: 11, fontFamily: T.sans, fontWeight: 600, color: T.ok, letterSpacing: '0.04em', marginBottom: 28 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.ok, boxShadow: `0 0 0 3px ${T.okSoft}` }}/>
            Live on Arc Testnet
          </div>

          <h1 style={{
            fontFamily: T.sans, fontSize: 56, fontWeight: 800,
            lineHeight: 1.06, letterSpacing: '-0.02em',
            color: T.ink1, margin: '0 0 24px',
          }}>
            The safety layer<br/>
            for AI agents that{' '}
            <span style={{ color: T.oxblood }}>move money.</span>
          </h1>

          <p style={{ fontSize: 17, lineHeight: 1.65, color: T.ink2, margin: '0 0 36px', maxWidth: 520, fontFamily: '"Inter", sans-serif', fontWeight: 400 }}>
            GuardAgent is an autonomous AI agent on Circle Arc. It swaps stablecoins, bridges across chains, and settles escrow jobs. Every action runs through a policy you wrote. Above your limit it pauses for your tap.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={() => { window.location.href = `${APP_URL}/dashboard`; }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '12px 22px', background: T.oxblood, color: '#fff', border: `1px solid ${T.oxblood2}`, borderRadius: r.sm, fontFamily: T.sans, fontSize: 13.5, fontWeight: 700, letterSpacing: '0.03em', cursor: 'pointer', transition: 'background 120ms' }}
              onMouseEnter={e => (e.currentTarget.style.background = T.oxblood2)}
              onMouseLeave={e => (e.currentTarget.style.background = T.oxblood)}
            >
              Open the app <IconArrowRight size={14}/>
            </button>
            <button
              onClick={() => { window.location.href = `${APP_URL}/chat`; }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '12px 22px', background: 'transparent', color: T.ink1, border: `1px solid ${T.border2}`, borderRadius: r.sm, fontFamily: T.sans, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', transition: 'background 120ms' }}
              onMouseEnter={e => (e.currentTarget.style.background = T.bg1)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <IconChat size={14}/> Talk to Aegis
            </button>
          </div>

          {/* trust strip */}
          <div style={{ display: 'flex', gap: 20, marginTop: 32, paddingTop: 28, borderTop: `1px solid ${T.border}` }}>
            {['Circle Arc · DCW', '37 Aegis tools', 'ERC-8004 · ERC-8183', 'CCTP V2'].map(tag => (
              <span key={tag} style={{ fontSize: 11, fontFamily: T.mono, color: T.ink4 }}>{tag}</span>
            ))}
          </div>
        </div>

        {/* Hero visuals */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'relative' }}>
          <div style={{ transform: 'rotate(-1.5deg)', transformOrigin: 'center' }}>
            <MockBalance/>
          </div>
          <div style={{ transform: 'rotate(1deg)', transformOrigin: 'center', marginLeft: 24 }}>
            <MockPolicy/>
          </div>
        </div>
      </section>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div style={{ background: T.bg1, borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 28px', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 0 }}>
          {[
            { v: '37', l: 'Aegis tools' },
            { v: '9', l: 'Circle products' },
            { v: '3', l: 'testnet chains' },
            { v: '90s', l: 'to first bridge' },
          ].map((s, i) => (
            <div key={s.v} style={{ textAlign: 'center', padding: '8px 0', borderRight: i < 3 ? `1px solid ${T.border}` : 'none' }}>
              <div style={{ fontFamily: T.sans, fontSize: 36, fontWeight: 800, color: T.ink1, letterSpacing: '-0.03em', lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontFamily: T.sans, fontSize: 11, fontWeight: 500, color: T.ink3, marginTop: 6, letterSpacing: '0.03em', textTransform: 'uppercase' }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Product features ──────────────────────────────────────────────── */}
      <section id="product" style={{ maxWidth: 1120, margin: '0 auto', padding: '100px 28px' }}>
        <div style={{ textAlign: 'center', marginBottom: 72 }}>
          <Eyebrow>The product</Eyebrow>
          <h2 style={{ fontFamily: T.sans, fontSize: 40, fontWeight: 800, color: T.ink1, letterSpacing: '-0.02em', margin: '0 0 16px', lineHeight: 1.1 }}>
            Three layers that make<br/>agentic commerce safe.
          </h2>
          <p style={{ fontSize: 16, lineHeight: 1.65, color: T.ink2, margin: '0 auto', maxWidth: 560, fontFamily: '"Inter", sans-serif' }}>
            One policy you write once. One AI agent you talk to in plain language. One forensic trail of every move.
          </p>
        </div>

        {[
          {
            icon: <div style={{ width: 36, height: 36, borderRadius: r.md, background: T.oxSoft, display: 'grid', placeItems: 'center', color: T.oxblood }}><IconShield size={18}/></div>,
            eyebrow: 'Guardian',
            h: 'Guardian, the policy.',
            p: 'Set the rails once. Per-transaction cap, daily limit, allowed tokens, slippage bounds. Every Aegis call gets pre-checked before it touches the chain. Above your threshold the agent stops and waits for Telegram.',
            bullets: ['Enforced in code, audited on chain', 'Dry-run console replays past actions', 'Telegram 2FA for above-threshold moves'],
            visual: <MockGuardian/>,
            reverse: false,
          },
          {
            icon: <div style={{ width: 36, height: 36, borderRadius: r.md, background: 'rgba(26,127,75,0.08)', display: 'grid', placeItems: 'center', color: T.ok }}><IconSparkle size={18}/></div>,
            eyebrow: 'Aegis',
            h: 'Aegis, the agent.',
            p: 'Plain language in, on-chain action out. 37 tools spanning swap, bridge, jobs, reputation, send, faucet. Aegis composes them, Guardian gates them, you watch the trace.',
            bullets: ['37 tools across the full Circle stack', 'Tool traces visible inline in chat', 'ERC-8004 reputation · ERC-8183 jobs · CCTP bridge'],
            visual: <MockChat/>,
            reverse: true,
          },
          {
            icon: <div style={{ width: 36, height: 36, borderRadius: r.md, background: 'rgba(29,78,216,0.08)', display: 'grid', placeItems: 'center', color: '#1D4ED8' }}><IconBuilding size={18}/></div>,
            eyebrow: 'Audit',
            h: 'Audit, the proof.',
            p: 'Every decision lands in a forensic timeline. The rule that fired, the action attempted, the verdict, the resulting tx hash. Allowed, blocked, pending. Exportable when you need a paper trail.',
            bullets: ['Verdict log for every Aegis call', 'Block rate, daily summary, per-rule attribution', 'CSV export with on-chain tx links'],
            visual: <MockAudit/>,
            reverse: false,
          },
        ].map((feat) => (
          <div key={feat.eyebrow} style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 64,
            alignItems: 'center',
            marginBottom: 80,
            direction: feat.reverse ? 'rtl' : 'ltr',
          }}>
            <div style={{ direction: 'ltr' }}>
              {feat.icon}
              <div style={{ fontFamily: T.sans, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: T.oxblood, margin: '14px 0 8px' }}>{feat.eyebrow}</div>
              <h3 style={{ fontFamily: T.sans, fontSize: 28, fontWeight: 800, color: T.ink1, letterSpacing: '-0.01em', margin: '0 0 14px', lineHeight: 1.15 }}>{feat.h}</h3>
              <p style={{ fontSize: 15, lineHeight: 1.65, color: T.ink2, margin: '0 0 20px', fontFamily: '"Inter", sans-serif' }}>{feat.p}</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {feat.bullets.map(b => (
                  <li key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13.5, color: T.ink2, fontFamily: '"Inter", sans-serif' }}>
                    <span style={{ width: 18, height: 18, borderRadius: r.sm, background: T.okSoft, display: 'grid', placeItems: 'center', color: T.ok, flexShrink: 0, marginTop: 1 }}><IconCheck size={10}/></span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ direction: 'ltr' }}>{feat.visual}</div>
          </div>
        ))}
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section id="how" style={{ background: T.bg1, borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '80px 28px' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <Eyebrow>How it works</Eyebrow>
            <h2 style={{ fontFamily: T.sans, fontSize: 36, fontWeight: 800, color: T.ink1, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.15 }}>
              First on-chain bridge in minutes.
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 2, position: 'relative' }}>
            {[
              { n: '01', h: 'Sign in', p: 'Email OTP via Privy. No seed phrases. A Circle DCW is provisioned automatically after your first login.' },
              { n: '02', h: 'Fund with faucet', p: 'One button drops $100 USDC test tokens + gas into your agent wallet from the Arc Testnet faucet.' },
              { n: '03', h: 'Set your policy', p: 'Open Guardian. Set a $50 per-transaction cap. The agent can never exceed it - enforced on every call.' },
              { n: '04', h: 'Talk to Aegis', p: '"Bridge 1 USDC to Base Sepolia." Aegis quotes, Guardian checks, CCTP submits. You see the tx hash.' },
            ].map((step, i) => (
              <div key={step.n} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: r.lg, padding: '24px 22px', position: 'relative', marginLeft: i > 0 ? -1 : 0 }}>
                <div style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 600, color: T.oxblood, letterSpacing: '0.08em', marginBottom: 12 }}>{step.n}</div>
                <h4 style={{ fontFamily: T.sans, fontSize: 16, fontWeight: 700, color: T.ink1, letterSpacing: '-0.01em', margin: '0 0 8px' }}>{step.h}</h4>
                <p style={{ fontSize: 13.5, lineHeight: 1.6, color: T.ink2, margin: 0, fontFamily: '"Inter", sans-serif' }}>{step.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Deliverables ──────────────────────────────────────────────────── */}
      <section id="deliverables" style={{ maxWidth: 1120, margin: '0 auto', padding: '100px 28px' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <Eyebrow>Built on Circle</Eyebrow>
          <h2 style={{ fontFamily: T.sans, fontSize: 36, fontWeight: 800, color: T.ink1, letterSpacing: '-0.02em', margin: '0 0 16px', lineHeight: 1.15 }}>
            The full Circle stack,<br/>wired and verified.
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: T.ink2, margin: '0 auto', maxWidth: 520, fontFamily: '"Inter", sans-serif' }}>
            Four core flows on nine Circle products. Each one runs live on testnet with on-chain receipts.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          {[
            { Icon: IconBridge, h: 'CCTP Crosschain', p: 'Bridge USDC from Arc Testnet to Base Sepolia or Ethereum Sepolia. Real burn on source, real mint on destination.', tag: 'Bridge Kit · CCTP V2', color: '#1D4ED8', bg: 'rgba(29,78,216,0.08)' },
            { Icon: IconBuilding, h: 'ERC-8183 Escrow', p: 'Smart-contract escrow for agent-to-agent commerce. Client posts, provider delivers, evaluator approves, USDC settles.', tag: 'Smart Contract Platform', color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
            { Icon: IconWallet, h: 'Circle Wallets', p: 'Developer-Controlled Wallet for the agent signer. User-Controlled Wallet through Privy email OTP. No seed phrases.', tag: 'DCW + UCW + Privy', color: T.oxblood, bg: T.oxSoft },
            { Icon: IconSwap, h: 'USDC ↔ EURC Swap', p: 'USDC to EURC at oracle rates. Aegis quotes inside chat. Guardian checks slippage. Tool calls visible in the trace.', tag: 'Swap Kit', color: T.ok, bg: T.okSoft },
          ].map(d => (
            <article key={d.h} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: r.lg, padding: '22px 20px', transition: 'border-color 150ms, box-shadow 150ms' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = T.border2; (e.currentTarget as HTMLElement).style.boxShadow = `0 6px 24px rgba(90,40,10,0.08)`; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = T.border; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
            >
              <div style={{ width: 36, height: 36, borderRadius: r.md, background: d.bg, display: 'grid', placeItems: 'center', color: d.color, marginBottom: 16 }}>
                <d.Icon size={18}/>
              </div>
              <h3 style={{ fontFamily: T.sans, fontSize: 15, fontWeight: 700, color: T.ink1, letterSpacing: '-0.01em', margin: '0 0 8px' }}>{d.h}</h3>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: T.ink2, margin: '0 0 16px', fontFamily: '"Inter", sans-serif' }}>{d.p}</p>
              <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.ink3, background: T.bg1, padding: '3px 8px', borderRadius: r.pill, border: `1px solid ${T.border}` }}>{d.tag}</span>
            </article>
          ))}
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '0 28px 100px' }}>
        <div style={{
          background: T.ink1, borderRadius: 12, padding: '64px 56px',
          display: 'grid', gridTemplateColumns: '1fr auto', gap: 48, alignItems: 'center',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* warm glow */}
          <div style={{ position: 'absolute', top: -60, right: 80, width: 360, height: 360, borderRadius: '50%', background: `radial-gradient(circle, rgba(196,98,42,0.25) 0%, transparent 70%)`, pointerEvents: 'none' }}/>
          <div style={{ position: 'relative' }}>
            <Eyebrow><span style={{ color: 'rgba(196,98,42,0.9)' }}>Try it now</span></Eyebrow>
            <h2 style={{ fontFamily: T.sans, fontSize: 36, fontWeight: 800, color: '#F0E8DC', letterSpacing: '-0.02em', margin: '0 0 14px', lineHeight: 1.1 }}>
              Your first on-chain bridge<br/>in minutes.
            </h2>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: 'rgba(240,232,220,0.65)', margin: 0, fontFamily: '"Inter", sans-serif', maxWidth: 480 }}>
              No card. No deposit. Testnet USDC comes from the Arc faucet, one tap away. The product reaches its main loop on the second screen.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
            <button
              onClick={() => { window.location.href = `${APP_URL}/dashboard`; }}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '13px 24px', background: T.oxblood, color: '#fff', border: `1px solid ${T.oxblood2}`, borderRadius: r.sm, fontFamily: T.sans, fontSize: 13.5, fontWeight: 700, letterSpacing: '0.03em', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 120ms' }}
              onMouseEnter={e => (e.currentTarget.style.background = T.oxblood2)}
              onMouseLeave={e => (e.currentTarget.style.background = T.oxblood)}
            >Open the app <IconArrowRight size={14}/></button>
            <a
              href="https://api.guardagent.org/api/infer/info"
              target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '13px 24px', background: 'rgba(255,255,255,0.06)', color: 'rgba(240,232,220,0.80)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: r.sm, fontFamily: T.sans, fontSize: 13.5, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
            >Live x402 API</a>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: `1px solid ${T.border}`, background: T.bg1 }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '28px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BrandMark size={18}/>
            <span style={{ fontFamily: T.sans, fontSize: 12, fontWeight: 700, color: T.ink1, letterSpacing: '0.06em', textTransform: 'uppercase' }}>GuardAgent</span>
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.ink4 }}>&copy; 2026 GuardAgent</div>
          <div style={{ display: 'flex', gap: 20 }}>
            {[
              { label: 'Privacy', href: '/privacy' },
              { label: 'Terms', href: '/terms' },
              { label: 'Sign in', href: `${APP_URL}/sign-in` },
            ].map(l => (
              <a key={l.label} href={l.href}
                style={{ fontFamily: T.sans, fontSize: 11.5, color: T.ink3, textDecoration: 'none', transition: 'color 100ms' }}
                onMouseEnter={e => (e.currentTarget.style.color = T.ink1)}
                onMouseLeave={e => (e.currentTarget.style.color = T.ink3)}
              >{l.label}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
