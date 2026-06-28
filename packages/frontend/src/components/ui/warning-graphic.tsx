'use client';

import { motion } from 'framer-motion';
import { ShieldAlert, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface WarningGraphicProps {
  title: string;
  description?: string;
  type?: 'critical' | 'warning' | 'info';
  onDismiss?: () => void;
  action?: ReactNode;
  className?: string;
}

const TYPE_CONFIG = {
  critical: {
    icon: <ShieldAlert size={22} />,
    color:  'text-red-400',
    bg:     'bg-red-500/8',
    border: 'border-red-500/25',
    glow:   'rgba(239,68,68,0.12)',
    accent: 'bg-red-500',
    label:  'CRITICAL',
  },
  warning: {
    icon: <AlertTriangle size={22} />,
    color:  'text-amber-400',
    bg:     'bg-amber-500/8',
    border: 'border-amber-500/25',
    glow:   'rgba(251,191,36,0.10)',
    accent: 'bg-amber-500',
    label:  'WARNING',
  },
  info: {
    icon: <AlertTriangle size={22} />,
    color:  'text-blue-400',
    bg:     'bg-blue-500/8',
    border: 'border-blue-500/20',
    glow:   'rgba(59,130,246,0.10)',
    accent: 'bg-blue-500',
    label:  'INFO',
  },
};

export function WarningGraphic({ title, description, type = 'critical', onDismiss, action, className }: WarningGraphicProps) {
  const cfg = TYPE_CONFIG[type];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      className={cn(
        'relative rounded-2xl border overflow-hidden',
        cfg.bg, cfg.border, className,
      )}
      style={{ boxShadow: `0 0 30px ${cfg.glow}, 0 0 0 1px ${cfg.border}` }}
    >
      {/* Animated top scan line */}
      <motion.div
        className={cn('absolute top-0 left-0 right-0 h-0.5', cfg.accent)}
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity }}
      />

      {/* HUD corner brackets */}
      <div className={cn('absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 rounded-tl', cfg.border)} />
      <div className={cn('absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 rounded-tr', cfg.border)} />
      <div className={cn('absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 rounded-bl', cfg.border)} />
      <div className={cn('absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 rounded-br', cfg.border)} />

      <div className="px-5 py-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          {/* Icon with pulse ring */}
          <div className="relative shrink-0 mt-0.5">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', cfg.bg, `border ${cfg.border}`)}>
              <span className={cfg.color}>{cfg.icon}</span>
            </div>
            {type === 'critical' && (
              <motion.div
                className="absolute inset-0 rounded-xl border border-red-500/40"
                animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={cn('text-[10px] font-black tracking-[0.2em] font-mono', cfg.color)}>
                {cfg.label}
              </span>
              {type === 'critical' && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
                </span>
              )}
            </div>
            <p className="text-white font-bold text-sm leading-tight">{title}</p>
          </div>

          {onDismiss && (
            <button
              onClick={onDismiss}
              className="shrink-0 text-slate-600 hover:text-slate-300 transition p-1 rounded-lg hover:bg-white/5"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {description && (
          <p className="text-slate-400 text-xs leading-relaxed ml-13 pl-[52px]">{description}</p>
        )}

        {action && <div className="mt-3 pl-[52px]">{action}</div>}
      </div>
    </motion.div>
  );
}
