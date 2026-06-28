'use client';

import { ReactNode, useRef, useState, MouseEvent } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

// ─── Gradient Border Card ───────────────────────────────────────
interface GradientCardProps {
  children: ReactNode;
  className?: string;
  gradient?: string;
  animate?: boolean;
}

export function GradientCard({ children, className, gradient, animate = false }: GradientCardProps) {
  const defaultGradient = 'linear-gradient(135deg, rgba(99,102,241,0.6) 0%, rgba(59,130,246,0.4) 50%, rgba(139,92,246,0.5) 100%)';

  return (
    <div
      className={cn('relative rounded-2xl p-[1px] overflow-hidden', animate && 'animate-gradient-x', className)}
      style={{ background: gradient ?? defaultGradient, backgroundSize: animate ? '200% 200%' : undefined }}
    >
      {/* Inner card */}
      <div className="relative rounded-[15px] bg-[#09091a] w-full h-full">
        {children}
      </div>
    </div>
  );
}

// ─── Moving Dot Card ────────────────────────────────────────────
// Animated dot that travels around the border
interface MovingDotCardProps {
  children: ReactNode;
  className?: string;
  dotColor?: string;
  speed?: number;
}

export function MovingDotCard({ children, className, dotColor = '#6366f1', speed = 4 }: MovingDotCardProps) {
  return (
    <div className={cn('relative rounded-2xl overflow-hidden', className)}>
      {/* SVG animated border dot */}
      <svg
        className="pointer-events-none absolute inset-0 w-full h-full"
        style={{ zIndex: 10 }}
      >
        <defs>
          <filter id="glow-dot">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* Border rect path */}
        <rect
          id="border-path"
          x="1" y="1"
          width="calc(100% - 2px)" height="calc(100% - 2px)"
          rx="15" ry="15"
          fill="none"
          stroke="rgba(99,102,241,0.12)"
          strokeWidth="1"
        />
        {/* Animated dot */}
        <circle r="4" fill={dotColor} filter="url(#glow-dot)" opacity="0.9">
          <animateMotion
            dur={`${speed}s`}
            repeatCount="indefinite"
            path="M 16 1 H calc(100% - 16) Q calc(100% - 1) 1 calc(100% - 1) 16 V calc(100% - 16) Q calc(100% - 1) calc(100% - 1) calc(100% - 16) calc(100% - 1) H 16 Q 1 calc(100% - 1) 1 calc(100% - 16) V 16 Q 1 1 16 1 Z"
          />
        </circle>
      </svg>

      {/* Static border */}
      <div className="absolute inset-0 rounded-2xl border border-[rgba(99,102,241,0.15)] pointer-events-none z-[5]" />

      {/* Content */}
      <div className="relative z-20 bg-[#09091a] rounded-2xl">
        {children}
      </div>
    </div>
  );
}

// ─── Shimmer Card ──────────────────────────────────────────────
interface ShimmerCardProps {
  children: ReactNode;
  className?: string;
}

export function ShimmerCard({ children, className }: ShimmerCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState({});

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setStyle({
      background: `radial-gradient(circle at ${x}% ${y}%, rgba(99,102,241,0.15) 0%, transparent 60%)`,
    });
  };

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setStyle({})}
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'relative rounded-2xl bg-[#09091a] border border-[rgba(99,102,241,0.15)] overflow-hidden',
        'hover:border-[rgba(99,102,241,0.3)] transition-colors',
        className,
      )}
    >
      {/* Shimmer overlay */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl z-10 transition-all duration-200" style={style} />
      {/* Top line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />
      <div className="relative z-20">{children}</div>
    </motion.div>
  );
}
