import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

/** A slowly drifting constellation. Each finished item lights one star in gold. Still when reduced motion is on. */
export function Sky({ lit }: { lit: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const litRef = useRef(lit);
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    litRef.current = lit;
    redraw.current();
  }, [lit]);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0;
    let H = 0;
    let stars: Star[] = [];
    let color = '214,224,255';
    let frame = 0;
    let raf = 0;

    const readColor = () => {
      color = getComputedStyle(document.documentElement).getPropertyValue('--star').trim() || color;
    };
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth;
      H = window.innerHeight;
      cv.width = W * dpr;
      cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(90, Math.max(30, (W * H) / 15000)));
      while (stars.length < n) {
        stars.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.14, vy: (Math.random() - 0.5) * 0.14, r: Math.random() * 1.2 + 0.4 });
      }
      stars = stars.slice(0, n);
    };
    const draw = () => {
      if (++frame % 60 === 1) readColor();
      ctx.clearRect(0, 0, W, H);
      const D = 130;
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const a = stars[i];
          const b = stars[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < D) {
            ctx.strokeStyle = `rgba(${color},${(1 - d / D) * 0.2})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      stars.forEach((s, i) => {
        if (i < litRef.current) {
          ctx.fillStyle = 'rgba(240,180,69,.2)';
          ctx.beginPath();
          ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(240,180,69,.95)';
          ctx.beginPath();
          ctx.arc(s.x, s.y, 2.4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = `rgba(${color},.55)`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    };
    const loop = () => {
      if (document.hidden) {
        raf = 0;
        return;
      }
      for (const s of stars) {
        s.x += s.vx;
        s.y += s.vy;
        if (s.x < 0 || s.x > W) s.vx *= -1;
        if (s.y < 0 || s.y > H) s.vy *= -1;
      }
      draw();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!reduce && !raf && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const refresh = () => {
      readColor();
      draw();
    };

    size();
    refresh();
    start();
    redraw.current = () => {
      if (reduce) draw();
    };
    const onResize = () => {
      size();
      draw();
    };
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', start);
    scheme.addEventListener('change', refresh);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', start);
      scheme.removeEventListener('change', refresh);
    };
  }, []);

  return (
    <div className="sky" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
