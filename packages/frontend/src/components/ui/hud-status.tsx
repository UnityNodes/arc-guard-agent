'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

type StatusLevel = 'nominal' | 'warning' | 'critical' | 'offline';

const STATUS_CONFIG: Record<StatusLevel, { color: string; bg: string; border: string; label: string; pulse: boolean }> = {
  nominal:  { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', label: 'Nominal',  pulse: false },
  warning:  { color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/25',   label: 'Warning',  pulse: true  },
  critical: { color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/25',     label: 'Critical', pulse: true  },
  offline:  { color: 'text-slate-500',   bg: 'bg-slate-500/10',   border: 'border-slate-500/20',   label: 'Offline',  pulse: false },
};

interface HudStatusProps {
  status: StatusLevel;
  label?: string;
  sublabel?: string;
  className?: string;
  compact?: boolean;
}

export function HudStatus({ status, label, sublabel, className, compact = false }: HudStatusProps) {
  const cfg = STATUS_CONFIG[status];

  return (
    <div className={cn(
      'flex items-center gap-2 rounded-xl border px-3 py-2 font-mono text-xs',
      cfg.bg, cfg.border, className,
    )}>
      {/* Indicator dot */}
      <span className="relative flex shrink-0 h-2 w-2">
        {cfg.pulse && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${cfg.color.replace('text-', 'bg-')}`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${cfg.color.replace('text-', 'bg-')}`} />
      </span>

      <div className="flex flex-col gap-0 leading-tight">
        <span className={cn('font-bold tracking-widest uppercase text-[10px]', cfg.color)}>
          {label ?? cfg.label}
        </span>
        {sublabel && !compact && (
          <span className="text-slate-500 text-[9px] tracking-wide">{sublabel}</span>
        )}
      </div>

      {/* Corner brackets. HUD aesthetic */}
      {!compact && (
        <div className="ml-auto flex items-center gap-1 opacity-30">
          <span className={cn('text-[8px] font-mono', cfg.color)}>[ SYS ]</span>
        </div>
      )}
    </div>
  );
}

interface HudPanelProps {
  title: string;
  value: string;
  status?: StatusLevel;
  delta?: string;
  deltaPositive?: boolean;
  className?: string;
}

export function HudPanel({ title, value, status = 'nominal', delta, deltaPositive, className }: HudPanelProps) {
  const cfg = STATUS_CONFIG[status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'relative rounded-2xl border overflow-hidden p-4',
        cfg.bg, cfg.border, className,
      )}
    >
      {/* Top left corner accent */}
      <div className={cn('absolute top-0 left-0 w-8 h-px', cfg.color.replace('text-', 'bg-'))} />
      <div className={cn('absolute top-0 left-0 w-px h-8', cfg.color.replace('text-', 'bg-'))} />
      {/* Bottom right corner accent */}
      <div className={cn('absolute bottom-0 right-0 w-8 h-px opacity-40', cfg.color.replace('text-', 'bg-'))} />
      <div className={cn('absolute bottom-0 right-0 w-px h-8 opacity-40', cfg.color.replace('text-', 'bg-'))} />

      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-1">{title}</p>
          <p className={cn('text-2xl font-extrabold tabular-nums tracking-tight', cfg.color)}>{value}</p>
          {delta && (
            <p className={cn(
              'text-xs font-semibold mt-1',
              deltaPositive ? 'text-emerald-400' : 'text-red-400',
            )}>
              {deltaPositive ? '▲' : '▼'} {delta}
            </p>
          )}
        </div>
        <div className={cn('text-[9px] font-mono uppercase tracking-widest opacity-40', cfg.color)}>
          STS:{status.slice(0, 3).toUpperCase()}
        </div>
      </div>
    </motion.div>
  );
}
