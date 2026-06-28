'use client';

import { useEffect, useState, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface Sparkle {
  id: string;
  x: string;
  y: string;
  size: number;
  opacity: number;
  delay: number;
}

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function generateSparkle(): Sparkle {
  return {
    id: Math.random().toString(36).slice(2),
    x: `${randomBetween(10, 90)}%`,
    y: `${randomBetween(10, 90)}%`,
    size: randomBetween(10, 20),
    opacity: randomBetween(0.5, 1),
    delay: randomBetween(0, 600),
  };
}

interface SparklesProps {
  children?: React.ReactNode;
  className?: string;
  color?: string;
  count?: number;
}

export function Sparkles({
  children,
  className,
  color = '#a78bfa',
  count = 8,
}: SparklesProps) {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  useEffect(() => {
    setSparkles(Array.from({ length: count }, generateSparkle));
    const interval = setInterval(() => {
      setSparkles(prev => {
        const idx = Math.floor(Math.random() * prev.length);
        const next = [...prev];
        next[idx] = generateSparkle();
        return next;
      });
    }, 400);
    return () => clearInterval(interval);
  }, [count]);

  return (
    <span className={cn('relative inline-block', className)}>
      {sparkles.map(s => (
        <motion.span
          key={s.id}
          style={{ position: 'absolute', left: s.x, top: s.y, zIndex: 10, pointerEvents: 'none' }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0, 1, 0], opacity: [0, s.opacity, 0] }}
          transition={{ duration: 0.8, delay: s.delay / 1000, ease: 'easeInOut' }}
        >
          <svg
            width={s.size}
            height={s.size}
            viewBox="0 0 68 68"
            fill="none"
            style={{ display: 'block' }}
          >
            <path
              d="M26.5 25.5C19.0042 17.3922 0 16 0 16C0 16 19 18 26.5 25.5C34 33 34 52 34 52C34 52 34 33 41.5 25.5C49 18 68 16 68 16C68 16 49.0042 17.3922 41.5 25.5C34 33 34 0 34 0C34 0 34 33 26.5 25.5Z"
              fill={color}
            />
          </svg>
        </motion.span>
      ))}
      <span className="relative z-20">{children}</span>
    </span>
  );
}
