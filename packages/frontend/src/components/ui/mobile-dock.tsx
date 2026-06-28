'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface DockItem {
  key: string;
  icon: ReactNode;
  label: string;
  badge?: number;
}

interface MobileDockProps {
  items: DockItem[];
  activeKey: string;
  onChange: (key: string) => void;
  className?: string;
}

export function MobileDock({ items, activeKey, onChange, className }: MobileDockProps) {
  return (
    <div className={cn(
      'fixed bottom-0 left-0 right-0 z-50 flex justify-around items-center',
      'bg-[#07070f]/90 backdrop-blur-xl border-t border-[rgba(99,102,241,0.15)]',
      'px-1 pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
      className,
    )}>
      {items.map((item) => {
        const isActive = item.key === activeKey;
        return (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            className="relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all min-w-[48px] min-h-[44px]"
          >
            {isActive && (
              <motion.div
                layoutId="dock-indicator"
                className="absolute inset-0 bg-indigo-600/15 rounded-xl border border-indigo-500/25"
                transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
              />
            )}
            <div className={cn(
              'relative z-10 w-6 h-6 flex items-center justify-center transition-colors',
              isActive ? 'text-indigo-400' : 'text-slate-500',
            )}>
              {item.icon}
              {item.badge != null && item.badge > 0 && (
                <span className="absolute -top-1 -right-1.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                  {item.badge > 9 ? '9+' : item.badge}
                </span>
              )}
            </div>
            <span className={cn(
              'relative z-10 text-[9px] font-semibold uppercase tracking-wide transition-colors',
              isActive ? 'text-indigo-400' : 'text-slate-600',
            )}>
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
