'use client';

interface MiniChartProps {
  data: number[];
  width?: number;
  height?: number;
  positive?: boolean;
}

export function MiniChart({ data, width = 64, height = 24, positive }: MiniChartProps) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const normalize = (v: number) => ((v - min) / range) * (height - 4) + 2;
  const step = width / (data.length - 1);

  const points = data
    .map((v, i) => `${i * step},${height - normalize(v)}`)
    .join(' ');

  const isPositive = positive ?? data[data.length - 1] >= data[0];
  const color = isPositive ? '#10b981' : '#ef4444';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      className="shrink-0"
    >
      {/* Fill area */}
      <defs>
        <linearGradient id={`grad-${isPositive}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={`${points} ${(data.length - 1) * step},${height} 0,${height}`}
        fill={`url(#grad-${isPositive})`}
        strokeWidth="0"
      />
      {/* Line */}
      <polyline
        points={points}
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
