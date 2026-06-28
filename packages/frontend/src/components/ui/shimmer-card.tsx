'use client';

import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface ShimmerCardProps {
  children: React.ReactNode;
  className?: string;
  shimmerColor?: string;
  /** Border color (CSS value) */
  borderColor?: string;
  /** Whether shimmer animates continuously (vs only on hover) */
  continuous?: boolean;
}

/**
 * Card wrapper with a sweeping shimmer/shine animation.
 * On hover the light reflection sweeps across the card surface.
 * When `continuous` is true the shimmer loops automatically.
 */
export function ShimmerCard({
  children,
  className,
  shimmerColor = 'rgba(99,102,241,0.18)',
  borderColor = 'rgba(99,102,241,0.15)',
  continuous = false,
}: ShimmerCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: -200, y: 0 });
  const [hovering, setHovering] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={cn('relative overflow-hidden rounded-2xl', className)}
      style={{ border: `1px solid ${borderColor}` }}
    >
      {/* Shimmer radial glow that follows cursor */}
      {(hovering || continuous) && (
        <div
          className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-300"
          style={{
            background: `radial-gradient(300px circle at ${pos.x}px ${pos.y}px, ${shimmerColor}, transparent 70%)`,
            opacity: hovering ? 1 : 0,
          }}
        />
      )}

      {/* Continuous sweep shimmer (only when continuous=true) */}
      {continuous && (
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            background:
              'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.04) 50%, transparent 70%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer-sweep 3s linear infinite',
          }}
        />
      )}

      {children}

      <style>{`
        @keyframes shimmer-sweep {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
    </div>
  );
}
