'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface AuroraBackgroundProps {
  children?: React.ReactNode;
  className?: string;
  showRadialGradient?: boolean;
}

export function AuroraBackground({
  children,
  className,
  showRadialGradient = true,
}: AuroraBackgroundProps) {
  return (
    <div className={cn('relative overflow-hidden', className)}>
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {/* Aurora layers */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background: `
              radial-gradient(ellipse 80% 50% at 20% -20%, rgba(99,102,241,0.25) 0%, transparent 60%),
              radial-gradient(ellipse 60% 50% at 80% -10%, rgba(59,130,246,0.20) 0%, transparent 60%),
              radial-gradient(ellipse 100% 60% at 50% 100%, rgba(139,92,246,0.15) 0%, transparent 60%)
            `,
          }}
        />
        {/* Animated aurora blobs */}
        <motion.div
          animate={{
            x: [0, 30, 0, -20, 0],
            y: [0, -20, 10, 0, 0],
            scale: [1, 1.05, 0.98, 1.02, 1],
          }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -top-40 left-1/4 w-[600px] h-[600px] rounded-full bg-indigo-600/10 blur-[100px]"
        />
        <motion.div
          animate={{
            x: [0, -40, 20, 0],
            y: [0, 30, -10, 0],
            scale: [1, 0.95, 1.05, 1],
          }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
          className="absolute top-20 right-1/4 w-[500px] h-[500px] rounded-full bg-blue-600/8 blur-[120px]"
        />
        <motion.div
          animate={{
            x: [0, 20, -30, 0],
            y: [0, -15, 25, 0],
          }}
          transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut', delay: 6 }}
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full bg-violet-600/8 blur-[100px]"
        />
        {showRadialGradient && (
          <div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(ellipse at center, transparent 40%, var(--bg) 80%)',
            }}
          />
        )}
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
