'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface FlickeringGridProps {
  className?: string;
  squareSize?: number;
  gridGap?: number;
  flickerChance?: number;
  color?: string;
  maxOpacity?: number;
}

export function FlickeringGrid({
  className,
  squareSize = 4,
  gridGap = 6,
  flickerChance = 0.3,
  color = 'rgb(99,102,241)',
  maxOpacity = 0.35,
}: FlickeringGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let cols = 0;
    let rows = 0;
    let opacities: Float32Array;

    const setup = () => {
      const { width, height } = container.getBoundingClientRect();
      canvas.width = width;
      canvas.height = height;
      cols = Math.floor(width / (squareSize + gridGap));
      rows = Math.floor(height / (squareSize + gridGap));
      opacities = new Float32Array(cols * rows).fill(0).map(() => Math.random() * maxOpacity);
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const idx = i * rows + j;
          if (Math.random() < flickerChance * 0.1) {
            opacities[idx] = Math.random() < 0.5
              ? Math.min(opacities[idx] + 0.05, maxOpacity)
              : Math.max(opacities[idx] - 0.05, 0);
          }
          ctx.fillStyle = color.replace(')', `, ${opacities[idx]})`).replace('rgb', 'rgba');
          ctx.fillRect(
            i * (squareSize + gridGap),
            j * (squareSize + gridGap),
            squareSize,
            squareSize,
          );
        }
      }
      animId = requestAnimationFrame(draw);
    };

    setup();
    draw();

    const ro = new ResizeObserver(setup);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, [squareSize, gridGap, flickerChance, color, maxOpacity]);

  return (
    <div ref={containerRef} className={cn('absolute inset-0 overflow-hidden', className)}>
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
