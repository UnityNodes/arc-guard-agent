'use client';

import { motion } from 'framer-motion';
import { Check, Clock, Zap, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

type StepStatus = 'done' | 'active' | 'pending' | 'locked';

interface RoadmapStep {
  id: string;
  label: string;
  description?: string;
  status: StepStatus;
  icon?: ReactNode;
}

interface RoadmapCardProps {
  title?: string;
  steps: RoadmapStep[];
  className?: string;
}

const STEP_CONFIG: Record<StepStatus, { icon: ReactNode; color: string; bg: string; border: string; line: string }> = {
  done:    { icon: <Check size={12} />,    color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', line: 'bg-emerald-500/40' },
  active:  { icon: <Zap size={12} />,      color: 'text-indigo-400',  bg: 'bg-indigo-500/15',  border: 'border-indigo-500/40',  line: 'bg-indigo-500/30'  },
  pending: { icon: <Clock size={12} />,    color: 'text-slate-400',   bg: 'bg-slate-700/20',   border: 'border-slate-700/40',   line: 'bg-slate-700/30'   },
  locked:  { icon: <Lock size={12} />,     color: 'text-slate-600',   bg: 'bg-slate-800/20',   border: 'border-slate-800/30',   line: 'bg-slate-800/20'   },
};

export function RoadmapCard({ title = 'Progress', steps, className }: RoadmapCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'relative rounded-2xl bg-[#09091a] border border-[rgba(99,102,241,0.15)] p-4 overflow-hidden',
        className,
      )}
    >
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent" />

      {title && (
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-3">{title}</p>
      )}

      <div className="space-y-1">
        {steps.map((step, i) => {
          const cfg = STEP_CONFIG[step.status];
          const isLast = i === steps.length - 1;

          return (
            <div key={step.id} className="flex gap-3">
              {/* Left: dot + connector line */}
              <div className="flex flex-col items-center">
                <motion.div
                  initial={step.status === 'active' ? { scale: 0.8 } : {}}
                  animate={step.status === 'active' ? { scale: [0.9, 1.05, 0.9] } : {}}
                  transition={{ duration: 2, repeat: Infinity }}
                  className={cn(
                    'w-6 h-6 rounded-full border flex items-center justify-center shrink-0',
                    cfg.bg, cfg.border, cfg.color,
                  )}
                >
                  {step.icon ?? cfg.icon}
                </motion.div>
                {!isLast && (
                  <div className={cn('w-px flex-1 my-1 min-h-[12px]', cfg.line)} />
                )}
              </div>

              {/* Right: content */}
              <div className={cn('pb-3 flex-1 min-w-0', isLast && 'pb-0')}>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-sm font-semibold leading-tight',
                    step.status === 'locked' ? 'text-slate-600' : step.status === 'done' ? 'text-slate-400 line-through' : 'text-white',
                  )}>
                    {step.label}
                  </span>
                  {step.status === 'active' && (
                    <span className="text-[9px] font-black tracking-wider text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded-full font-mono">
                      NOW
                    </span>
                  )}
                </div>
                {step.description && (
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{step.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
