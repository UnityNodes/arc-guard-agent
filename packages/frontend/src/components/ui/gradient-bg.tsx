'use client';

import { useEffect, useRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface GradientAnimationBGProps {
  children?: ReactNode;
  className?: string;
}

export function GradientAnimationBG({ children, className }: GradientAnimationBGProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    let animId: number;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };

    const colors = [
      [99, 102, 241],   // indigo
      [59, 130, 246],   // blue
      [139, 92, 246],   // violet
      [16, 185, 129],   // emerald accent
    ];

    const orbs = colors.map((c, i) => ({
      x: 0.2 + i * 0.2,
      y: 0.3 + (i % 2) * 0.4,
      r: [c[0], c[1], c[2]] as [number, number, number],
      vx: (Math.random() - 0.5) * 0.002,
      vy: (Math.random() - 0.5) * 0.002,
    }));

    // Cache computed bg color outside the animation loop (avoid getComputedStyle per frame)
    let cachedBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#04040a';
    const updateBg = () => { cachedBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#04040a'; };
    document.addEventListener('visibilitychange', updateBg);

    const draw = () => {
      frame++;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Pause when tab is hidden, saves CPU/battery at scale
      if (document.hidden) { animId = requestAnimationFrame(draw); return; }

      // Deep background, use CSS variable for theme support (cached outside hot loop)
      const bgColor = cachedBg;
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);

      orbs.forEach((orb) => {
        orb.x += orb.vx + Math.sin(frame * 0.008 + orb.r[0] * 0.01) * 0.001;
        orb.y += orb.vy + Math.cos(frame * 0.006 + orb.r[1] * 0.01) * 0.001;
        if (orb.x < 0 || orb.x > 1) orb.vx *= -1;
        if (orb.y < 0 || orb.y > 1) orb.vy *= -1;

        const grd = ctx.createRadialGradient(orb.x * w, orb.y * h, 0, orb.x * w, orb.y * h, Math.min(w, h) * 0.45);
        grd.addColorStop(0, `rgba(${orb.r.join(',')},0.18)`);
        grd.addColorStop(1, 'transparent');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);
      });

      animId = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', updateBg); };
  }, []);

  return (
    <div className={cn('relative overflow-hidden', className)}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
