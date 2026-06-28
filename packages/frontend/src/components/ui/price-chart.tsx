'use client';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PricePoint {
  time: string;
  price: number;
}

interface PriceChartProps {
  symbol: string;
  data: PricePoint[];
  currentPrice?: number;
  change24h?: number;
  className?: string;
  height?: number;
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0d0d1f] border border-[rgba(99,102,241,0.25)] rounded-xl px-3 py-2 shadow-xl">
      <p className="text-[10px] text-slate-500 font-mono mb-0.5">{label}</p>
      <p className="text-white font-bold text-sm tabular-nums">
        ${payload[0].value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
    </div>
  );
}

export function PriceChart({ symbol, data, currentPrice, change24h = 0, className, height = 160 }: PriceChartProps) {
  const isPositive = change24h >= 0;
  const color = isPositive ? '#10b981' : '#ef4444';
  const gradientId = `price-grad-${symbol}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={cn(
        'relative rounded-2xl bg-[#09091a] border border-[rgba(99,102,241,0.15)] p-4 overflow-hidden',
        className,
      )}
    >
      {/* Top scan line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-white font-bold text-base">{symbol}</span>
            <span className="text-[10px] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full font-mono">
              24h
            </span>
          </div>
          {currentPrice != null && (
            <div className="text-2xl font-extrabold text-white tabular-nums tracking-tight mt-0.5">
              ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
        </div>
        <div className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-sm font-bold',
          isPositive
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            : 'bg-red-500/10 border-red-500/20 text-red-400',
        )}>
          {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {isPositive ? '+' : ''}{change24h.toFixed(2)}%
        </div>
      </div>

      {/* Chart */}
      {data.length > 1 ? (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: '#475569', fontSize: 10, fontFamily: 'monospace' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: '#475569', fontSize: 10, fontFamily: 'monospace' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="price"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 4, fill: color, stroke: '#0d0d1f', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-32 text-slate-600 gap-2">
          <Activity size={16} />
          <span className="text-sm">No price data</span>
        </div>
      )}
    </motion.div>
  );
}

// ─── Area Chart Analytics Card ─────────────────────────────────
interface AnalyticsPoint {
  label: string;
  value: number;
  value2?: number;
}

interface AreaAnalyticsCardProps {
  title: string;
  total: string;
  subtitle?: string;
  data: AnalyticsPoint[];
  color?: string;
  color2?: string;
  className?: string;
}

export function AreaAnalyticsCard({
  title, total, subtitle, data,
  color = '#6366f1', color2 = '#3b82f6',
  className,
}: AreaAnalyticsCardProps) {
  const gradId = `area-grad-${title.replace(/\s/g, '')}`;
  const gradId2 = `area-grad2-${title.replace(/\s/g, '')}`;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'relative rounded-2xl bg-[#09091a] border border-[rgba(99,102,241,0.15)] p-4 overflow-hidden',
        className,
      )}
    >
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent" />

      {/* Header */}
      <div className="mb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">{title}</p>
        <p className="text-2xl font-extrabold text-white tabular-nums mt-0.5">{total}</p>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>

      <ResponsiveContainer width="100%" height={90}>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
            <linearGradient id={gradId2} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color2} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color2} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            contentStyle={{ background: '#0d0d1f', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 12, fontSize: 11 }}
            labelStyle={{ color: '#64748b' }}
            itemStyle={{ color: '#e2e8f0' }}
          />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradId})`} dot={false} />
          {data[0]?.value2 != null && (
            <Area type="monotone" dataKey="value2" stroke={color2} strokeWidth={1.5} fill={`url(#${gradId2})`} dot={false} strokeDasharray="4 2" />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
