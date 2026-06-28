'use client';
import React from 'react';

const TOKEN_LOGOS: Record<string, string> = {
  USDC: '/tokens/usdc.svg',
  EURC: '/tokens/eurc.svg',
  CIRBTC: '/tokens/cirbtc.svg',
  USYC: '/tokens/usyc.png',
};

export const TokenMark = ({ symbol, size = 18 }: { symbol: string; size?: number }) => {
  const logo = TOKEN_LOGOS[symbol.toUpperCase()];
  if (logo) {
    return (
      <img
        src={logo}
        alt={symbol}
        width={size}
        height={size}
        style={{ borderRadius: '50%', flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
      />
    );
  }
  return (
    <span className={`token-mark ${symbol.toLowerCase()}`} style={{ width: size, height: size, fontSize: size * 0.5 }}>
      {symbol[0]}
    </span>
  );
};

export const TokenChip = ({ symbol, size = 'md' }: { symbol: string; size?: 'sm' | 'md' }) => {
  const px = size === 'sm' ? 14 : 18;
  const fs = size === 'sm' ? 8 : 9;
  return (
    <span className="token-chip">
      <span className={`token-mark ${symbol.toLowerCase()}`} style={{ width: px, height: px, fontSize: fs }}>
        {symbol === 'USDC' ? '$' : symbol === 'EURC' ? '€' : symbol === 'USYC' ? 'Y' : symbol[0]}
      </span>
      <span>{symbol}</span>
    </span>
  );
};

export const ChainPill = ({ chain }: { chain: string }) => {
  const colors: Record<string, { from: string; to: string }> = {
    Arc: { from: '#ff9648', to: '#f57a26' },
    Ethereum: { from: '#627eea', to: '#3c5fc4' },
    Base: { from: '#0052ff', to: '#003ec7' },
  };
  const c = colors[chain] || colors.Arc;
  return (
    <span className="chain-pill">
      <span style={{ width: 14, height: 14, borderRadius: 999, background: `linear-gradient(135deg, ${c.from}, ${c.to})`, display: 'inline-block' }}/>
      {chain}
    </span>
  );
};

export const Sparkline = ({ data, color = 'var(--amber-400)', height = 36 }: { data: number[]; color?: string; height?: number }) => {
  const id = React.useId();
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 200;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => [i * step, height - 4 - ((v - min) / range) * (height - 8)]);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  const area = d + ` L ${w} ${height} L 0 ${height} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.25"/>
          <stop offset="1" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sp-${id})`}/>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
};

export const Donut = ({ data, size = 140 }: { data: { label: string; value: number; color: string }[]; size?: number }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2 - 12;
  const cx = size / 2, cy = size / 2;
  let acc = 0;
  const arcs = data.map(d => {
    const start = acc / total * Math.PI * 2 - Math.PI / 2;
    acc += d.value;
    const end = acc / total * Math.PI * 2 - Math.PI / 2;
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    return { d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`, color: d.color };
  });
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-3)" strokeWidth="18"/>
      {arcs.map((a, i) => (
        <path key={i} d={a.d} fill="none" stroke={a.color} strokeWidth="18" strokeLinecap="butt"/>
      ))}
    </svg>
  );
};

export const QrPlaceholder = ({ size = 140 }: { size?: number }) => {
  const cells: [number, number][] = [];
  const N = 21;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const isFinder = (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7);
      if (isFinder) {
        const inX = x < 7 ? x : x - (N - 7);
        const inY = y < 7 ? y : y - (N - 7);
        const onEdge = inX === 0 || inX === 6 || inY === 0 || inY === 6;
        const center = inX >= 2 && inX <= 4 && inY >= 2 && inY <= 4;
        if (onEdge || center) cells.push([x, y]);
        continue;
      }
      const h = ((x * 31 + y * 17) ^ (x + y)) & 7;
      if (h > 3) cells.push([x, y]);
    }
  }
  const s = size / N;
  return (
    <div style={{ width: size, height: size, background: 'white', padding: s, borderRadius: 8 }}>
      <svg width={size - 2 * s} height={size - 2 * s} viewBox={`0 0 ${N} ${N}`}>
        {cells.map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="1" height="1" fill="#1a1006" />
        ))}
      </svg>
    </div>
  );
};

export const Avatar = ({ name, size = 28 }: { name: string; size?: number }) => {
  const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const h = name.charCodeAt(0) * 17 % 360;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, hsl(${h} 70% 60%), hsl(${(h + 40) % 360} 70% 45%))`,
      display: 'grid', placeItems: 'center',
      color: 'white', fontSize: size * 0.4, fontWeight: 600,
      flexShrink: 0,
    }}>{initials}</div>
  );
};

export const formatUsd = (n: number, decimals = 2) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const formatNum = (n: number, decimals = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const Skeleton = ({
  width = '100%',
  height = 14,
  radius = 6,
  style,
}: { width?: number | string; height?: number | string; radius?: number; style?: React.CSSProperties }) => (
  <div
    aria-hidden
    style={{
      width, height, borderRadius: radius,
      background: 'linear-gradient(90deg, var(--bg-2) 0%, var(--bg-3) 50%, var(--bg-2) 100%)',
      backgroundSize: '200% 100%',
      animation: 'ga-shimmer 1.4s ease-in-out infinite',
      ...style,
    }}
  />
);

export const SkeletonCard = ({ lines = 3 }: { lines?: number }) => (
  <div style={{
    background: 'var(--bg-2)', border: '1px solid var(--line-1)',
    borderRadius: 'var(--r-md)', padding: 18, display: 'flex', flexDirection: 'column', gap: 10,
  }}>
    <Skeleton width="40%" height={12} />
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} height={10} />
    ))}
  </div>
);

export const ErrorState = ({
  title = 'Could not load',
  message,
  onRetry,
}: { title?: string; message?: string; onRetry?: () => void }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 10, padding: '32px 20px', textAlign: 'center',
    background: 'rgba(255,90,90,0.04)', border: '1px solid rgba(255,90,90,0.18)',
    borderRadius: 'var(--r-md)',
  }}>
    <div style={{ fontSize: 22 }}>⚠</div>
    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{title}</div>
    {message && <div style={{ fontSize: 12, color: 'var(--ink-3)', maxWidth: 380, lineHeight: 1.5 }}>{message}</div>}
    {onRetry && (
      <button
        onClick={onRetry}
        style={{
          background: 'var(--bg-3)', border: '1px solid var(--line-1)',
          padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
          color: 'var(--ink-1)', cursor: 'pointer', marginTop: 4,
        }}
      >Retry</button>
    )}
  </div>
);

export const EmptyState = ({
  title,
  desc,
  icon,
  action,
}: {
  title: string;
  desc: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 10, padding: '40px 24px', textAlign: 'center',
  }}>
    {icon && (
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: 'var(--bg-3)', border: '1px solid var(--line-1)',
        display: 'grid', placeItems: 'center', color: 'var(--amber-300)',
        marginBottom: 4,
      }}>
        {icon}
      </div>
    )}
    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>{title}</div>
    <div style={{ fontSize: 12, color: 'var(--ink-3)', maxWidth: 360, lineHeight: 1.5 }}>{desc}</div>
    {action && <div style={{ marginTop: 6 }}>{action}</div>}
  </div>
);
